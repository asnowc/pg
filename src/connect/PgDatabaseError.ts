import type { PgErrorFields } from "@/protocol.ts";

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
