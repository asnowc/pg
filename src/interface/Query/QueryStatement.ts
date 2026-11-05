import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "./QueryReader.ts";
import { PreparedStatement } from "@/class/PreparedStatement.ts";

/** @public */
export type SqlWithTextArgs = {
  /** 单条 SQL 语句片段 */
  readonly sqlStatement: string | Uint8Array;
  /**
   * null 表示 SQL NULL，不进行文本或二进制编码。
   * 参数数量不能超过 65535.
   */
  readonly textArgs?: (string | null)[];
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
};

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
  | SqlWithTextArgs
  | PreparedStatement
  | ArrayLike<string | Uint8Array | SqlWithTextArgs | PreparedStatement>;

/** @public */
export type TypedSqlStatement<T = unknown> = {
  readonly sqlStatement: SqlStatement;
  getResultDecoder(field: FieldInfo): PgColumnDataDecoder;
  checkRow?(value: T): void;
};

/**
 * 推断查询结果的类型
 * @public
 */
export type InferQueryResult<T> = T extends TypedSqlStatement<infer P> ? P : unknown;
