import type { PgSessionInfo } from "@/protocol.ts";
import type { Query } from "@/query.ts";

/**
 * 已经完成认证的 PostgreSQL 连接接口，提供执行 SQL 查询、打开游标以及复制数据的功能。
 * @public
 */
export interface PgConnection extends Query, AsyncDisposable {
  /** 认证后收集的服务端参数、取消请求密钥和事务状态。 */
  readonly session: PgSessionInfo;
  /** 连接是否已关闭或因不可恢复的协议/网络错误而失效。 */
  readonly closed: boolean;
  close(): Promise<void>;

  [Symbol.asyncDispose](): Promise<void>;
}
