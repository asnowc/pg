import type { PgErrorFields } from "@/protocol.ts";

/** 由 ErrorResponse 转换的数据库错误，可替代 pg.DatabaseError。 */
export declare class PgDatabaseError extends Error implements PgErrorFields {
  readonly severity: string;
  readonly severityNonLocalized?: string;
  readonly code: string;
  readonly detail?: string;
  readonly hint?: string;
  readonly position?: string;
  readonly internalPosition?: string;
  readonly internalQuery?: string;
  readonly where?: string;
  readonly schema?: string;
  readonly table?: string;
  readonly column?: string;
  readonly dataType?: string;
  readonly constraint?: string;
  readonly file?: string;
  readonly line?: string;
  readonly routine?: string;
  readonly unknown?: Readonly<Record<string, string>>;
  constructor(fields: PgErrorFields, options?: ErrorOptions);
}
