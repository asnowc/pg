import type { PgErrorFields } from "@/interface/protocol.ts";

/**
 * 客户端不支持服务端要求的认证机制。
 * @public
 */
export class PgAuthenticationError extends Error {
  readonly mechanism?: string;
  constructor(message: string, mechanism?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PgAuthenticationError";
    this.mechanism = mechanism;
  }
}
/**
 * 由 ErrorResponse 转换的数据库错误，可替代 pg.DatabaseError。
 * @public
 */
export class PgDatabaseError extends Error {
  readonly info: PgErrorFields;
  readonly unknown?: Readonly<Record<string, string>>;
  constructor(fields: PgErrorFields, options?: ErrorOptions) {
    super(fields.message, options);
    this.name = "PgDatabaseError";
    this.info = fields;
  }
}
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
