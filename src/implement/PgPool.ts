import { PgSession } from "@/protocol.ts";
import { connectPgSession } from "@/protocol/connect.ts";
import type {
  ConnectionSource,
  PgConnectOptions,
  PgPoolConnection as IPgPoolConnection,
} from "@/interface/Connection.ts";
import { PgPoolConnection } from "./PgConnection.ts";
import { QueryOptions, QueryReader, SingleQueryOperation, SqlStatement } from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./private/sql_statement.ts";
import QueryReaderImpl from "./private/QueryReader.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { closeByteStream, Pool, PoolPgSession } from "./Pool.ts";

/**
 * 原生连接池配置。调用方建立流，连接池执行认证。
 * @public
 * @since 0.3.0
 */
export interface CreatePoolOptions {
  /**
   * 每次调用返回一个新的已连接流及认证选项，无需预先执行 PostgreSQL 认证。
   */
  create: () => Promise<{ stream: ConnectionSource; connectOptions: PgConnectOptions<ConnectionSource> }>;
  /**
   * 最大连接数，默认 3。必须是正整数。
   */
  maxCount?: number;
  /**
   * 每条连接最多同时承载的池级 query 请求数，默认 1。
   * 必须是正整数或 Infinity（不限制）；等待到对应 ReadyForQuery 后释放名额。
   * PostgreSQL 仍顺序执行这些请求。borrow() 借出的连接保持独占，不受此限制。
   */
  maxPipeline?: number;
  /**
   * 空闲回收时间（毫秒），默认 0（不回收）。
   */
  idleTimeout?: number;
  /**
   * 创建连接失败时的重试次数，默认 0（不重试）。
   */
  createRetry?: number;
}

/** @public */
export class PgPool implements SingleQueryOperation, AsyncDisposable {
  /**
   * 创建惰性建连的原生连接池。池级查询自动归还连接；事务、游标和 COPY 必须结束或取消。
   * QueryReader 的行会先物化，再归还连接，因此延迟消费结果不会读取其他借用者的数据。
   * @public
   */
  constructor(options: CreatePoolOptions) {
    checkOptions(options);

    this.#maxConnection = options.maxCount ?? 3;
    this.#maxPipeline = options.maxPipeline ?? 1;
    this.#createRetry = options.createRetry ?? 0;
    this.#createConnection = options.create;
    this.#poolCore = new Pool(options.idleTimeout ?? 0);
  }
  #poolCore: Pool;
  #connecting = 0;
  #pipelineQueue = new Set<PoolPgSession>();
  /** 最大连接数 */
  #maxConnection: number;
  #maxPipeline: number;
  /** 创建连接失败时的重试次数 */
  #createRetry: number;
  /** 空闲连接数 */
  get idleCount(): number {
    return this.#poolCore.free.size;
  }
  /** 总连接数 */
  get totalCount(): number {
    return this.#poolCore.connectedCount + this.#connecting;
  }

  #createConnection: CreatePoolOptions["create"];
  async #create() {
    let session: PoolPgSession;
    this.#connecting++;
    try {
      const { connectOptions, stream } = await this.#createConnection();
      session = await connectPgSession(stream, connectOptions) as PoolPgSession;
      this.#createRetry = 0;
    } catch (e) {
      this.#createRetry++;
      if (this.#createRetry < this.#createRetry) this.#create();
      else {
        this.#createRetry = 0;
        this.#poolCore.clearWaitQueue(e instanceof Error ? e : new Error(String(e)));
      }
      return;
    } finally {
      this.#connecting--;
      if (this.#closed && this.totalCount === 0 && !this.#poolCore.waitQueue.head) this.#closed.resolve();
    }
    session.meta = { date: Date.now(), borrowed: false, idle: true };

    if (this.#destroyed) {
      closeByteStream(session);
      return;
    }
    session.on("close", () => {
      this.#poolCore.pool.delete(session);
      this.#poolCore.free.delete(session);
      this.#pipelineQueue.delete(session);
      if (this.#closed && this.totalCount === 0) {
        this.#poolCore.clearWaitQueue(new Error("Pool is closed"));
        this.#closed.resolve();
      }
    });
    session.on("release", () => this.#onRelease(session));
    session.on("idle", () => this.#onIdle(session));
    this.#poolCore.addItem(session);
  }
  #onRelease(session: PoolPgSession) {
    session.meta.borrowed = false;
    if (session.meta.idle) this.#poolCore.freeItem(session);
  }
  #onIdle(session: PoolPgSession) {
    session.meta.idle = true;
    this.#pipelineQueue.delete(session);
    if (!session.meta.borrowed) this.#poolCore.freeItem(session);
  }
  #onPipelineReady(session: PoolPgSession) {
    this.#pipelineQueue.delete(session);
    if (this.closed || session.pendingQueyNumber === 0) return;
    this.#offerPipelineSlot(session);
  }
  #offerPipelineSlot(session: PoolPgSession) {
    if (session.pendingQueyNumber >= this.#maxPipeline) return;
    let prev;
    let item = this.#poolCore.waitQueue.head;
    while (item) {
      if (item.pipeline) {
        session.meta.idle = false;
        this.#poolCore.waitQueue.remove(item, prev);
        item.resolve(session);
        return;
      }
      prev = item;
      item = item.next;
    }
    this.#pipelineQueue.add(session);
  }

  #getSession(resolve: (session: PoolPgSession) => void, reject: (error: unknown) => void): boolean {
    if (this.closed) throw new Error("Pool is closed");

    if (this.#poolCore.free.size) {
      const session = shiftSet(this.#poolCore.free);
      session.meta.borrowed = true;
      resolve(session);
      return true;
    }
    this.#pushWait({ resolve, reject, pipeline: false });
    return false;
  }
  #getSessionForPipeLine(resolve: (session: PoolPgSession) => void, reject: (error: unknown) => void): boolean {
    if (this.closed) throw new Error("Pool is closed");

    if (this.#poolCore.free.size) {
      const session = shiftSet(this.#poolCore.free);
      session.meta.idle = false;
      resolve(session);
      return true;
    }
    if (this.#pipelineQueue.size) {
      const session = shiftSet(this.#pipelineQueue);
      session.meta.idle = false;
      resolve(session);
      return true;
    }
    this.#pushWait({ pipeline: true, resolve, reject });
    return false;
  }
  #pushWait(item: {
    pipeline: boolean;
    resolve(session: PoolPgSession): void;
    reject(reason: unknown): void;
  }) {
    this.#poolCore.waitQueue.push(item);
    if (this.totalCount < this.#maxConnection) {
      this.#create();
    }
  }

  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  borrow(): Promise<IPgPoolConnection> {
    return new Promise((resolve, reject) => {
      this.#getSession((session) => resolve(new PgPoolConnection(session, release)), reject);
    });
  }

  #closed?: PromiseWithResolvers<void>;
  get closed(): boolean {
    return this.#poolCore.closed;
  }
  /** 关闭连接池。关闭后不再接受新的连接请求。Promise 在所有连接关闭后完成。 */
  async close(): Promise<void> {
    const promises = this.#poolCore.close();
    if (!promises) return this.#closed?.promise;

    this.#pipelineQueue.clear();
    this.#closed = Promise.withResolvers();
    try {
      await Promise.all(promises);
    } catch (e) {
      this.#closed.reject(e);
    }
    if (this.totalCount === 0) this.#closed.resolve();
    return this.#closed.promise;
  }
  #destroyed = false;
  /** 销毁连接池，立即关闭所有连接并释放资源。 */
  destroy(): void {
    this.#destroyed = true;
    this.#closed ??= Promise.withResolvers();
    this.#poolCore.closed = true;
    this.#poolCore.clearTimer();
    this.#pipelineQueue.clear();
    const error = new Error("Pool is destroyed");
    this.#closed.resolve();
    this.#poolCore.clearWaitQueue(error);
    for (const session of this.#poolCore.pool) {
      session.destroy(error);
    }
    this.#poolCore.free.clear();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): QueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReaderImpl<T>(() => {
      return new Promise((resolve, reject) => {
        this.#getSessionForPipeLine((session) => {
          const queryWriteQueue = session.queryWriter;
          const promise = queryWriteQueue.extendedQuery<T>(encoder);
          queryWriteQueue.sync(() => this.#onPipelineReady(session));
          this.#offerPipelineSlot(session);
          promise.then(resolve).catch(reject);
        }, reject);
      });
    });
  }
}
function checkOptions(options: CreatePoolOptions) {
  if (options.maxCount !== undefined && (!Number.isSafeInteger(options.maxCount) || options.maxCount <= 0)) {
    throw new RangeError("maxCount must be a positive integer");
  }
  if (
    options.maxPipeline !== undefined && options.maxPipeline !== Infinity &&
    (!Number.isSafeInteger(options.maxPipeline) || options.maxPipeline <= 0)
  ) {
    throw new RangeError("maxPipeline must be a positive integer or Infinity");
  }
  if (options.createRetry !== undefined && (!Number.isSafeInteger(options.createRetry) || options.createRetry < 0)) {
    throw new RangeError("createRetry must be a non-negative integer");
  }
  if (options.idleTimeout !== undefined && (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)) {
    throw new RangeError("idleTimeout must be non-negative and finite");
  }
}

function shiftSet<T>(set: Set<T>): T {
  for (const element of set) {
    set.delete(element);
    return element;
  }
  throw new Error("Set is empty");
}
function release(session: PgSession) {
  session.emit("release");
}
