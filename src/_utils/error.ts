/**
 * 报文格式、长度或状态违反 PostgreSQL 协议。
 */
export class PgProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PgProtocolError";
  }
}
