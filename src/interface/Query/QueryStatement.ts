import type { PgDataDecodeContext, PgDataDecoderMap } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "./QueryResult.ts";

/** @public */
export interface StatementEncoder {
  /** 计算 Parse 消息的字节长度。不包含头部信息的字节长度 */
  calculateParseByteLength(): number;
  /** 将 Parse 消息编码到指定的 Uint8Array 中 */
  encodeParseInto(data: Uint8Array, offset: number): number;

  /** 计算 Bind 消息的字节长度。不包含头部信息的字节长度 */
  calculateBindByteLength(): number;
  /** 将 Bind 消息编码到指定的 Uint8Array 中 */
  encodeBindInto(data: Uint8Array, offset: number): number;
}
/** @public */
export interface SimpleQueryEncoder {
  /** 计算 Simple Query 消息的字节长度。不包含头部信息的字节长度 */
  calculateByteLength(): number;
  /** 将 Simple Query 消息编码到指定的 Uint8Array 中 */
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
