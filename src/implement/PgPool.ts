import { PgSession } from "@/protocol.ts";
import { connectPgSession } from "@/protocol/connect.ts";
import type {
  ConnectionSource,
  PgConnectOptions,
  PgPoolConnection as IPgPoolConnection,
} from "@/interface/Connection.ts";
import { eachLink, LinkList } from "@/_utils/LinkList.ts";
import { PgPoolConnection } from "./PgConnection.ts";
import {
  QueryOptions,
  QueryReader,
  SingleQueryOperation,
  SqlStatement,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { sqlStatementToSqlEncoder } from "./private/sql_statement.ts";
import QueryReaderImpl from "./private/QueryReader.ts";

/**
 * 原生连接池配置。建连和认证由调用方注入 。
 *  @public
 */
export interface CreatePoolOptions {
  /** 每次调用必须返回一个新的、已经完成认证的连接。 */
  create: () => Promise<{ stream: ConnectionSource; connectOptions: PgConnectOptions<ConnectionSource> }>;
  /** 最大连接数，默认 3。必须是正整数。 */
  maxCount?: number;
  /** 空闲回收时间（毫秒），默认 0（不回收）。 */
  idleTimeout?: number;
  /** 创建连接失败时的重试次数，默认 0（不重试）。 */
  createRetry?: number;
}
type PoolConnState = {
  /** isFree 状态更新的最后更新时间 */
  date: number;
};
type PoolPgSession = PgSession<PoolConnState>;

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
    this.#idleTimeout = options.idleTimeout ?? 0;
    this.#createRetry = options.createRetry ?? 0;
    this.#createConnection = options.create;
  }
  #connecting = 0;
  #pool = new Set<PoolPgSession>();
  #free = new Set<PoolPgSession>(); // 写队列和读队列都空闲的连接
  /** 最大连接数 */
  #maxConnection: number;
  /** 空闲回收时间（毫秒） */
  #idleTimeout: number;
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

  #createConnection: CreatePoolOptions["create"];
  async #create() {
    let session: PoolPgSession;
    this.#connecting++;
    try {
      const { connectOptions, stream } = await this.#createConnection();
      session = await connectPgSession(stream, connectOptions) as PoolPgSession;
      session.meta = { date: Date.now() };
      this.#createRetry = 0;
    } catch (e) {
      this.#createRetry++;
      if (this.#createRetry < this.#createRetry) this.#create();
      else {
        this.#createRetry = 0;
        this.#clearWaitQueue(e instanceof Error ? e : new Error(String(e)));
      }
      return;
    } finally {
      this.#connecting--;
    }

    session.on("close", () => {
      this.#pool.delete(session);
      this.#free.delete(session);
      if (this.#closed && this.totalCount === 0) this.#closed.resolve();
    });
    session.on("release", () => {
      this.#onFree(session);
    });

    this.#pool.add(session);
    this.#onFree(session);
  }
  #onFree(session: PoolPgSession) {
    const next = this.#waitQueue.shift();
    if (next) return void next.resolve(session);
    if (this.closed) return void closeByteStream(session);

    session.meta.date = Date.now();
    this.#free.add(session);
    if (!this.#timer && this.#idleTimeout > 0) this.#setTimeoutCheck();
  }
  #setTimeoutCheck() {
    this.#timer = setTimeout(() => {
      checkTimeout(this.#pool, this.#free, this.#idleTimeout);
      this.#setTimeoutCheck();
    }, this.#idleTimeout);
  }

  #timer?: NodeJS.Timeout;
  #clearWaitQueue(error: Error) {
    for (const item of eachLink(this.#waitQueue.head)) {
      item.reject(error);
    }
    this.#waitQueue.clear();
  }

  #waitQueue = new LinkList<{ resolve(session: PoolPgSession): void; reject(reason: unknown): void }>();
  #getSession(): Promise<PoolPgSession> | PoolPgSession {
    if (this.closed) throw new Error("Pool is closed");
    let min: PoolPgSession | undefined;
    for (const session of this.#free) {
      if (!min || session.ttl < min.ttl) min = session;
    }
    if (min) {
      this.#free.delete(min);
      return min;
    }
    return new Promise((resolve, reject) => {
      this.#waitQueue.push({ resolve, reject });
      if (this.totalCount < this.#maxConnection) this.#create();
    });
  }

  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  async borrow(): Promise<IPgPoolConnection> {
    const session = await this.#getSession();
    return new PgPoolConnection(session, release);
  }

  #closed?: PromiseWithResolvers<void>;
  get closed(): boolean {
    return !!this.#closed;
  }
  /** 关闭连接池。关闭后不再接受新的连接请求。Promise 在所有连接关闭后完成。 */
  async close(): Promise<void> {
    if (this.#closed) return this.#closed.promise;
    this.#closed = Promise.withResolvers();

    const promises: Promise<void>[] = [];
    for (const session of this.#free) {
      this.#pool.delete(session);
      promises.push(session.close());
    }
    this.#free.clear();
    try {
      await Promise.all(promises);
    } catch (e) {
      this.#closed.reject(e);
    }

    if (this.#connecting == 0) {
      this.#closed.resolve();
    }
    return this.#closed.promise;
  }
  /** 销毁连接池，立即关闭所有连接并释放资源。 */
  destroy(): void {
    this.#closed = Promise.withResolvers();
    const error = new Error("Pool is destroyed");
    this.#closed.resolve();
    this.#clearWaitQueue(error);
    for (const session of this.#free) {
      session.destroy(error);
    }
    this.#free.clear();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  query<T>(queryable: SqlStatement<T> | TypedSqlStatementEncoder<T>, options?: QueryOptions): QueryReader<T> {
    const encoder = sqlStatementToSqlEncoder(queryable, options);
    return new QueryReaderImpl<T>(async () => {
      const session = await this.#getSession();
      const promise = session.extendedQuery<T>(encoder);
      session.sync();
      return promise;
    });
  }
}
function checkOptions(options: CreatePoolOptions) {
  if (options.maxCount !== undefined && (!Number.isSafeInteger(options.maxCount) || options.maxCount <= 0)) {
    throw new RangeError("maxCount must be a positive integer");
  }
  if (options.createRetry !== undefined && (!Number.isSafeInteger(options.createRetry) || options.createRetry < 0)) {
    throw new RangeError("createRetry must be a non-negative integer");
  }
  if (options.idleTimeout !== undefined && (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)) {
    throw new RangeError("idleTimeout must be non-negative and finite");
  }
}

function closeByteStream(session: PgSession) {
  session.close().catch(() => {});
}
function checkTimeout(map: Set<PgSession>, set: Set<PoolPgSession>, timeout: number) {
  const now = Date.now();
  for (const session of set) {
    const state = session.meta;
    if (now - state.date > timeout) {
      set.delete(session);
      map.delete(session);
      closeByteStream(session);
    }
  }
}

function release(session: PgSession) {
  session.emit("release");
}
