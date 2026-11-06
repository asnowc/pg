import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "./QueryReader.ts";
import { PreparedStatement } from "@/class/PreparedStatement.ts";

/**
 * 表示可以包含单条 SQL 语句的查询对象
 * @public
 */
export type SqlStatement = string | Uint8Array | PreparedStatement;
/**
 * 表示可以包含多条 SQL 语句的查询对象
 * @public
 */
export type SqlStatements =
  | string
  | Uint8Array
  | PreparedStatement
  | ArrayLike<string | Uint8Array | PreparedStatement>;
