import type { PgErrorFields } from "@/interface/protocol.ts";

/**
 * 客户端不支持服务端要求的认证机制。
 * @public
 */
export class PgAuthenticationError extends Error {
  readonly mechanism?: string;
  constructor(message: string, options?: ErrorOptions & { mechanism?: string }) {
    super(message, options);
    this.name = "PgAuthenticationError";
    this.mechanism = options?.mechanism;
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
