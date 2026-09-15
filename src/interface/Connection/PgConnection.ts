import type {
  CopyQueryOperation,
  ExtendedQueryOperation,
  SampleQueryOperation,
  TransactionQuery,
} from "@/interface/Query.ts";
import type { PgSessionInfo } from "@/interface/protocol.ts";

/**
 * 已经完成认证的 PostgreSQL 连接接口，提供执行 SQL 查询、打开游标以及复制数据的功能。
 * @public
 */
export interface PgConnection
  extends ExtendedQueryOperation, SampleQueryOperation, CopyQueryOperation, TransactionQuery, AsyncDisposable {
  /** 认证后收集的服务端参数、取消请求密钥和事务状态。 */
  readonly session: PgSessionInfo;
  /** 连接是否已关闭或因不可恢复的协议/网络错误而失效。 */
  readonly closed: boolean;
  close(): Promise<void>;

  [Symbol.asyncDispose](): Promise<void>;
}
/** @public */
export interface PgPool
  extends ExtendedQueryOperation, SampleQueryOperation, CopyQueryOperation, TransactionQuery, AsyncDisposable {
  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  connect(): Promise<PgPoolConnection>;

  /** 空闲连接数 */
  get idleCount(): number;
  /** 总连接数 */
  get totalCount(): number;

  /** 关闭连接池。关闭后不再接受新的连接请求。Promise 在所有连接关闭后完成。 */
  close(): Promise<void>;
  /** 拒绝新的借用，等待已借出的资源归还及物理连接关闭。 */
  [Symbol.asyncDispose](): Promise<void>;
}

/** @public */
export interface PgPoolConnection
  extends ExtendedQueryOperation, SampleQueryOperation, CopyQueryOperation, TransactionQuery, Disposable {
  get released(): boolean;
  /** 幂等释放。现有操作结束后才实际归还连接；此后不再接受新操作。 */
  release(): void;
  [Symbol.dispose](): void;
}
