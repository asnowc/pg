import { connectPgSession } from "@/protocol/connect.ts";
import type { PgPoolConnection as IPgPoolConnection } from "@/interface/Connection.ts";
import { PgPoolConnection } from "./PgConnection.ts";
import { QueryOptions, QueryReader, SingleQueryOperation, SqlStatement } from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./private/sql_statement.ts";
import QueryReaderImpl from "./private/QueryReader.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import {
  checkOptions,
  checkTimeout,
  clearWaitQueue,
  closeByteStream,
  getMinQueryNumberSession,
  PoolPgSession,
  release,
  shiftSet,
  TimeoutChecker,
  WaitQueueItem,
} from "./Pool.ts";
import type { CreatePoolOptions } from "./Pool.ts";
import { LinkList } from "@/_utils/LinkList.ts";

export type { CreatePoolOptions } from "./Pool.ts";

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
    this.#timeoutChecker = new TimeoutChecker((time) => {
      checkTimeout(this.#pool, this.#free, time);
      return this.#free.size > 0 && !this.closed;
    }, options.idleTimeout ?? 0);
  }
  #pool = new Set<PoolPgSession>();
  /**
   * 空闲的连接，未被借用
   */
  #free = new Set<PoolPgSession>(); // 空闲的连接
  /**
   * 正在执行池级 pipeline 查询的连接
   */
  #pipeline = new Set<PoolPgSession>();
  get connectedCount(): number {
    return this.#pool.size;
  }
  #connecting = 0;
  /** 最大连接数 */
  #maxConnection: number;
  #maxPipeline: number;
  /** 创建连接失败时的重试次数 */
  #createRetry: number;
  /** 空闲连接数 */
  get idleCount(): number {
    return this.#free.size;
  }
  /** 总连接数 */
  get totalCount(): number {
    return this.#pool.size + this.#connecting;
  }
  #timeoutChecker: TimeoutChecker;
  private clearTimer() {
    this.#timeoutChecker.clearTimer();
  }
  #createConnection: CreatePoolOptions["create"];
  #checkCreate() {
    if (this.totalCount < this.#maxConnection) this.#create();
  }
  async #create() {
    let session: PoolPgSession;
    this.#connecting++;
    try {
      const { connectOptions, stream } = await this.#createConnection();
      session = await connectPgSession(stream, connectOptions) as PoolPgSession;
      this.#createRetry = 0;
      if (this.#destroyed) return closeByteStream(session);
    } catch (e) {
      if (this.#destroyed) {
        this.#createRetry = 0;
        return;
      }
      this.#createRetry++;
      if (this.#createRetry < this.#createRetry) this.#create(); // 重试
      else {
        this.#createRetry = 0;
        clearWaitQueue(this.#waitQueue, e instanceof Error ? e : new Error(String(e)));
        if (this.#closedWaitingQueueClear && this.totalCount === 1) {
          this.#closedWaitingQueueClear.resolve();
        }
      }
      return;
    } finally {
      this.#connecting--;
    }
    session.meta = { date: Date.now() };

    session.on("close", () => {
      this.#pool.delete(session);
      this.#free.delete(session);
      this.#pipeline.delete(session);
      if (this.#closedWaitingQueueClear && this.totalCount === 0) {
        this.#closedWaitingQueueClear.resolve();
      }
    });
    session.on("release", () => {
      if (session.pendingQueyNumber === 0) this.#onSessionFree(session);
      else this.#pipeline.add(session);
    });
    session.on("idle", () => {
      if (this.#pipeline.delete(session)) {
        this.#onSessionFree(session);
      }
    });
    this.#pool.add(session);
    this.#onSessionFree(session);
  }

  #onSessionFree(session: PoolPgSession) {
    let next = this.#waitQueue.head;
    if (next) {
      if (next.pipeline) {
        this.#pipeline.add(session);
        do {
          this.#waitQueue.shift();
          next.resolve(session);
          next = this.#waitQueue.head;
        } while (next && next.pipeline && session.pendingQueyNumber < next.pipeline);
      } else {
        this.#waitQueue.shift();
        next.resolve(session);
        return;
      }
      return;
    }
    if (this.closed) return void closeByteStream(session);
    session.meta.date = Date.now();
    this.#free.add(session);
    this.#timeoutChecker.setTimeIfNoSet();
  }

  #getSession(
    resolve: (session: PoolPgSession) => void,
    reject: (error: unknown) => void,
    maxPipeline?: number,
  ): boolean {
    if (this.closed) throw new Error("Pool is closed");
    if (this.#free.size) {
      const session = shiftSet(this.#free);
      if (maxPipeline) this.#pipeline.add(session);
      resolve(session);
      return true;
    }
    if (maxPipeline) {
      const minSession = getMinQueryNumberSession(this.#pipeline, maxPipeline);
      if (minSession) {
        this.#checkCreate();
        resolve(minSession);
        return true;
      }
    }
    this.#waitQueue.push({ pipeline: maxPipeline, resolve, reject });
    this.#checkCreate();
    return false;
  }
  /** 等待队列，存放等待获取连接的请求 */
  readonly #waitQueue = new LinkList<WaitQueueItem>();

  #closedWaitingQueueClear?: PromiseWithResolvers<void>;
  #closed?: true | Promise<void>;
  get closed(): boolean {
    return !!(this.#closedWaitingQueueClear || this.#closed);
  }
  /** 关闭连接池。关闭后不再接受新的连接请求。Promise 在所有连接关闭后完成。 */
  async close(): Promise<void> {
    if (this.#closedWaitingQueueClear) return this.#closedWaitingQueueClear.promise;
    if (this.#closed) {
      if (this.#closed === true) return;
      return this.#closed;
    }
    this.#closedWaitingQueueClear = Promise.withResolvers();
    this.clearTimer();
    if (!this.#waitQueue.head) {
      const promises: Promise<void>[] = [];
      for (const item of this.#free) promises.push(item.close().catch(() => item.destroy()));
      for (const item of this.#pipeline) promises.push(item.close().catch(() => item.destroy()));
      await Promise.all(promises);
    }
    if (this.totalCount === 0) {
      this.#closedWaitingQueueClear.resolve();
      this.#closed = true;
      this.#closedWaitingQueueClear = undefined;
    } else {
      await this.#closedWaitingQueueClear.promise;
      this.#closed = true;
      this.#closedWaitingQueueClear = undefined;
    }
  }
  #destroyed = false;
  /** 销毁连接池，立即关闭所有连接并释放资源。 */
  destroy(): void {
    this.#destroyed = true;
    this.#closedWaitingQueueClear ??= Promise.withResolvers();
    this.clearTimer();
    this.#pipeline.clear();
    const error = new Error("Pool is destroyed");
    this.#closedWaitingQueueClear.resolve();
    clearWaitQueue(this.#waitQueue, error);
    for (const session of this.#pool) {
      session.destroy(error);
    }
    this.#free.clear();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  borrow(): Promise<IPgPoolConnection> {
    return new Promise((resolve, reject) => {
      this.#getSession((session) => resolve(new PgPoolConnection(session, release)), reject);
    });
  }
  query<T>(queryable: TypedSqlStatement<T>, options?: PoopQueryOptions): QueryReader<T>;
  query<T>(queryable: SqlStatement, options?: PoopQueryOptions & QueryOptionsWithDecoder): QueryReader<T>;
  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: PoopQueryOptions & QueryOptionsWithDecoder,
  ): QueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReaderImpl<T>(() => {
      return new Promise((resolve, reject) => {
        const maxPipeline = options?.maxPipeline ?? this.#maxPipeline;
        this.#getSession(
          (session) => {
            const queryWriteQueue = session.queryWriter;
            const promise = queryWriteQueue.extendedQuery<T>(encoder);
            queryWriteQueue.sync();
            promise.then(resolve).catch(reject);
          },
          reject,
          maxPipeline,
        );
      });
    });
  }
}
export type PoopQueryOptions = QueryOptions & {
  maxPipeline?: number;
};
