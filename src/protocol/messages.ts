import type { PgFormat } from "./const.ts";
/**
 * PostgreSQL 消息类型定义。
 * 包含客户端发送给服务端的消息类型（PgFrontendMessage）以及服务端发送给客户端的消息类型（PgBackendMessage）。
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html
 */

/** PostgreSQL 对象标识符。 */
type PgOid = number;

export interface PgErrorFields {
  severity: string;
  severityNonLocalized?: string;
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}

export interface PgFieldDescription {
  name: string;
  tableOid: PgOid;
  columnAttribute: number;
  dataTypeOid: PgOid;
  dataTypeSize: number;
  typeModifier: number;
  format: PgFormat;
}

export interface PgCopyResponse {
  overallFormat: PgFormat;
  columnFormats: readonly PgFormat[];
}
