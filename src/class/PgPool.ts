import { createPgPoolConnection, PgPoolConnection } from "./PgConnection.ts";
import {
  Cursor as ICursor,
  CursorOpenOptions,
  CursorQueryOperation,
  QueryOptions,
  QueryReader,
  SingleQueryOperation,
  SqlStatement,
  Transaction as ITransaction,
  TransactionMode,
  TransactionQueryOperation,
} from "@/interface/Query.ts";
import { TypedSqlStatement } from "./PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import {
  checkOptions,
  checkTimeout,
  clearWaitQueue,
  closeByteStream,
  closeIdleAndPipeline,
  getMinQueryNumberSession,
  prepareConnection,
  shiftSet,
  TimeoutChecker,
  WaitQueueItem,
} from "./Pool.ts";
import type { CreatePoolOptions } from "./Pool.ts";
import { CountLinkList } from "@/_utils/LinkList.ts";
import { poolForTest } from "./PgPoolForTest.ts";
import { ConnQueryOperation } from "./QueryOperation.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import { isolationQuery } from "./private/QueryFunction.ts";
import Transaction from "@/class/private/Transaction.ts";
import Cursor from "@/class/private/Cursor.ts";

export type { CreatePoolOptions } from "./Pool.ts";
/** @public */
export class PgPool implements SingleQueryOperation, CursorQueryOperation, TransactionQueryOperation, AsyncDisposable {
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
      checkTimeout(this.#pool, this.#idle, time);
      return this.#idle.size > 0 && !this.closed;
    }, options.idleTimeout ?? 0);
  }
  #pool = new Set<PgSession>();
  /**
   * 空闲的连接，未被借用
   */
  #idle = new Map<PgSession, number>(); // 空闲的连接
  /**
   * 正在执行池级 pipeline 查询的连接
   */
  #pipeline = new Set<PgSession>();
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
    return this.#idle.size;
  }
  /** 总连接数 */
  get totalCount(): number {
    return this.#pool.size + this.#connecting;
  }
  get queueLength(): number {
    return this.#waitQueue.length;
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
    let session: PgSession;
    this.#connecting++;
    try {
      const connection = await this.#createConnection();
      session = ConnQueryOperation.transferSession(connection);
      this.#connecting--;
      this.#createRetry = 0;
      if (this.#closed) {
        // destroyed
        session.destroy();
        return;
      }
    } catch (e) {
      this.#connecting--;
      if (this.#closed) {
        // destroyed
        this.#createRetry = 0;
        return;
      }
      if (this.#closedWaitingQueueClear) {
        this.#createRetry = 0;
        if (this.#pool.size === 0 && this.#connecting === 0) {
          clearWaitQueue(this.#waitQueue, e instanceof Error ? e : new Error(String(e)));
        }
        if (this.#closedWaitingQueueClear && this.totalCount === 0) {
          this.#closedWaitingQueueClear.resolve();
        }
        return;
      }
      this.#createRetry++;
      if (this.#createRetry < this.#createRetry) this.#create(); // 重试
      else {
        this.#createRetry = 0;
        clearWaitQueue(this.#waitQueue, e instanceof Error ? e : new Error(String(e)));
      }
      return;
    }

    const onIdle = () => {
      if (this.#pipeline.delete(session)) {
        this.#onSessionIdle(session);
      }
    };
    const onClose = () => {
      session.off("idle", onIdle);
      session.off("close", onClose);
      if (this.#pool.delete(session)) {
        this.#idle.delete(session);
        this.#pipeline.delete(session);
      }
      if (this.#closedWaitingQueueClear && this.totalCount === 0) {
        this.#closedWaitingQueueClear.resolve();
      }
    };
    session.on("close", onClose);
    session.on("idle", onIdle);
    this.#pool.add(session);
    this.#onSessionIdle(session);
  }
  #onRelease(session: PgSession) {
    if (session.closed) return;
    if (session.pendingQueyNumber === 0) this.#onSessionIdle(session);
    else this.#pipeline.add(session);
  }
  async prepareConnection(number: number) {
    const size = Math.min(number, this.#maxConnection - this.totalCount);
    if (size <= 0) return;
    await prepareConnection(size, () => this.#create());
  }

  #onSessionIdle(session: PgSession) {
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
    this.#idle.set(session, Date.now());
    this.#timeoutChecker.setTimeIfNoSet();
  }
  #getIdleSession(): PgSession | undefined {
    if (this.closed) throw new Error("Pool is closed");
    if (this.#idle.size) return shiftSet(this.#idle.keys(), this.#idle);
    return undefined;
  }

  #getSession = (): PgSession | Promise<PgSession> => {
    const session = this.#getIdleSession();
    if (session) return session;
    return new Promise((resolve, reject) => {
      this.#waitQueue.push({ resolve, reject });
      this.#checkCreate();
    });
  };
  #getSessionForPipeline = (maxPipeline: number = this.#maxPipeline): PgSession | Promise<PgSession> => {
    const session = this.#getIdleSession();
    if (session) {
      this.#pipeline.add(session);
      return session;
    }
    // 对于接受 pipeline 的请求，尝试从 pipeline 中获取最小查询数的 session
    const minSession = getMinQueryNumberSession(this.#pipeline, maxPipeline);
    if (minSession) {
      this.#checkCreate();
      return minSession;
    }
    return new Promise((resolve, reject) => {
      this.#waitQueue.push({ pipeline: maxPipeline, resolve, reject });
      this.#checkCreate();
    });
  };

  /** 等待队列，存放等待获取连接的请求 */
  readonly #waitQueue = new CountLinkList<WaitQueueItem>();

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
    if (!this.#waitQueue.head) await closeIdleAndPipeline(this.#idle.keys(), this.#pipeline);
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
  /** 销毁连接池，立即关闭所有连接并释放资源。 */
  destroy(): void {
    if (this.#closed) return;
    this.#closedWaitingQueueClear?.resolve();
    this.#closedWaitingQueueClear = undefined;
    this.#closed = true;
    this.clearTimer();
    const error = new Error("Pool is destroyed");
    clearWaitQueue(this.#waitQueue, error);
    for (const session of this.#pool) {
      session.destroy(error);
    }
    this.#pipeline.clear();
    this.#idle.clear();
    this.#pool.clear();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  async borrow(): Promise<PgPoolConnection> {
    const session = await this.#getSession();
    return createPgPoolConnection(session, this.#onRelease);
  }
  query<T>(queryable: TypedSqlStatement<T>, options?: PoopQueryOptions): QueryReader<T>;
  query<T>(queryable: SqlStatement, options?: PoopQueryOptions & QueryOptionsWithDecoder): QueryReader<T>;
  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: PoopQueryOptions & QueryOptionsWithDecoder,
  ): QueryReader<T> {
    return isolationQuery(this.#maxPipeline ? this.#getSessionForPipeline : this.#getSession, queryable, options);
  }

  begin(mode?: TransactionMode): ITransaction {
    return new Transaction(this.#getSession, this.#onRelease, mode);
  }
  open<T>(queryable: TypedSqlStatement<T>, options?: CursorOpenOptions): ICursor<T>;
  open<T>(queryable: SqlStatement, options?: CursorOpenOptions & QueryOptionsWithDecoder): ICursor<T>;
  open<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: CursorOpenOptions & QueryOptionsWithDecoder,
  ): ICursor<T> {
    return new Cursor<T>(this.#getSession, this.#onRelease, queryable, options);
  }
  static {
    poolForTest.getPooInternalPool = (pool: PgPool) => ({
      pool: pool.#pool,
      idle: pool.#idle,
      inPipeline: pool.#pipeline,
    });
  }
}
export type PoopQueryOptions = QueryOptions & {
  maxPipeline?: number;
};
