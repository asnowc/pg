/**
 * 报文格式、长度或状态违反 PostgreSQL 协议。
 */
export class PgProtocolError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}
export class UnexpectedEOFError extends Error {
  constructor(message = "Unexpected end of file") {
    super(message);
  }
}
export class InternalError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`@asla/pg internal error: ${message}`, options);
  }
}

export class SessionClosedError extends Error {
  constructor() {
    super("The PostgreSQL session has been closed");
  }
}
export class SessionDestroyedError extends Error {
  constructor() {
    super("The PostgreSQL session has been destroyed");
  }
}

export class NoDecoderError extends Error {
  constructor(OID: number, columnName: string, index: number) {
    super(`No decoder found for column ${columnName} at index ${index}. OID=${OID}`);
  }
}
export class HandleUnavailableError extends Error {
  constructor(message = "The handle is unavailable") {
    super(message);
  }
}
//TODO: 给 Error 分类
export function throwRewrittenError(e: unknown): never {
  if (e instanceof Error) {
    e = new Error("query field", { cause: e });
  } else {
    e = new Error(String(e));
  }
  throw e;
}
