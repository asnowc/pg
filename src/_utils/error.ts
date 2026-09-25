/**
 * 报文格式、长度或状态违反 PostgreSQL 协议。
 */
export class PgProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PgProtocolError";
  }
}
export class UnexpectedEOFError extends Error {
  constructor() {
    super("Unexpected end of file");
    this.name = "UnexpectedEOFError";
  }
}
export class InternalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`@asla/pg internal error: ${message}`, options);
  }
}
