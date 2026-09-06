/**
 * 报文格式、长度或状态违反 PostgreSQL 协议。
 * @public
 */
export class PgProtocolError extends Error {
  readonly messageCode?: number;
  constructor(message: string, options?: ErrorOptions & { messageCode?: number }) {
    super(message);
    if (options?.messageCode !== undefined) {
      this.messageCode = options.messageCode;
    }
    this.name = "PgProtocolError";
  }
}
