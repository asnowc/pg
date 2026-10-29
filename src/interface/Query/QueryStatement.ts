import type { PgColumnDecoder } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "./QueryReader.ts";
import type { JsDataEncoder2 } from "@/interface/js_data_encoder.ts";

/** @public */
export type TypedSqlStatement<T = unknown> = {
  readonly sqlStatement: string | Uint8Array;
  readonly args: unknown[];
  getArgEncoder(value: unknown): JsDataEncoder2;
  getResultDecoder(field: FieldInfo, index: number): PgColumnDecoder;
  check(value: T): T;
};

/** @public */
export type SqlWithTextArgs = {
  /** 单条 SQL 语句片段 */
  readonly sqlStatement: string | Uint8Array;
  /**
   * null 表示 SQL NULL，不进行文本或二进制编码。
   * 参数数量不能超过 65535.
   */
  readonly textArgs?: (string | null)[];
};

/**
 * 表示可以包含单条 SQL 语句的查询对象
 * @public
 */
export type SqlStatement = SqlWithTextArgs | string | Uint8Array | TypedSqlStatement;
/**
 * 表示可以包含多条 SQL 语句的查询对象
 * @public
 */
export type SqlStatements =
  | string
  | SqlWithTextArgs
  | TypedSqlStatement
  | Uint8Array
  | ArrayLike<SqlWithTextArgs | TypedSqlStatement | Uint8Array | string>;

/**
 * 推断查询结果的类型
 * @public
 */
export type InferQueryResult<T> = T extends TypedSqlStatement<infer P> ? P : unknown;
