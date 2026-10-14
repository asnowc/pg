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

export class SessionClosedError extends Error {
  constructor() {
    super("The PostgreSQL session has been closed");
    this.name = "SessionClosedError";
  }
}
export class SessionDestroyedError extends Error {
  constructor() {
    super("The PostgreSQL session has been destroyed");
    this.name = "SessionDestroyedError";
  }
}

export class NoDecoderError extends Error {
  constructor(OID: number, columnName: string, index: number) {
    super(`No decoder found for column ${columnName} at index ${index}. OID=${OID}`);
    this.name = "NoDecoderError";
  }
}

export function throwRewrittenError(e: unknown): never {
  if (e instanceof Error) {
    Error.captureStackTrace(e);
  } else {
    e = new Error(String(e));
  }
  throw e;
}
