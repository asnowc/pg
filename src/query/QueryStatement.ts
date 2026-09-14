import type { PgDataDecodeContext, PgDataDecoderMap } from "./data_decoder.ts";
import type { FieldInfo } from "./MessageData.ts";

/** @public */
export interface StatementEncoder {
  calculateParseByteLength(): number;
  encodeParseInto(data: Uint8Array, offset: number): number;

  calculateBindByteLength(): number;
  encodeBindInto(data: Uint8Array, offset: number): number;
}
/** @public */
export interface SimpleQueryEncoder {
  calculateByteLength(): number;
  encodeQueryInto(data: Uint8Array, offset: number): number;
}

/** @public */
export type QueryDecoder<T> = {
  /**
   * typeID -> ColumnParser
   */
  readonly typeDecoders?: PgDataDecoderMap;

  readonly columnDecoders?: ColumnDecoderMap | ColumnDecoderGetter;
  __infer?(input: T): never;
};

/** @public */
export type TypedSqlStatementEncoder<T = unknown> = QueryDecoder<T> & StatementEncoder;

/** @public */
export type TypedSqlStatement<T = unknown> = QueryDecoder<T> & {
  /** 单条 SQL 语句片段 */
  readonly sqlStatement: string;
  /**
   * null 表示 SQL NULL，不进行文本或二进制编码。
   * 参数数量不能超过 65535.
   */
  readonly args?: (string | null)[];
};

/**
 * 表示可以包含单条 SQL 语句的查询对象
 * @public
 */
export type SqlStatement<T> = TypedSqlStatementEncoder<T> | TypedSqlStatement<T> | string;
/**
 * 表示可以包含多条 SQL 语句的查询对象
 * @public
 */
export type SqlStatements = SimpleQueryEncoder | SqlStatement<unknown> | Iterable<SqlStatement<unknown>>;

/** @public */
export type ColumnDecoderGetter = (field: FieldInfo) => ColumnDecoder;
/** @public */
export type ColumnDecoderMap = ReadonlyMap<number, ColumnDecoder>;

/** @public */
export type ColumnDecoder<T = unknown> = {
  text(value: string, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
  binary(value: Uint8Array, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
};

/**
 * 推断查询结果的类型
 * @public
 */
export type InferQueryResult<T> = T extends { __infer?(v: infer P): never } ? P : unknown;
