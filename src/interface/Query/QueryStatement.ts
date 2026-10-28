import type { PgDataDecodeContext, PgDataDecoderMap } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "./QueryReader.ts";
import type { JsDataEncoderGetter } from "@/interface/js_data_encoder.ts";

export type SqlStatementWithRawArgs = {
  readonly sqlStatement: string | Uint8Array;
  readonly args: unknown[];
  readonly argsEncoderGetter: JsDataEncoderGetter;
  readonly columnDecoders?: ColumnDecoderGetter;
};

export type SqlStatementWithTextArgs = {
  readonly sqlStatement: string | Uint8Array;
  readonly textArgs?: (string | null)[];
  readonly columnDecoders?: ColumnDecoderGetter;
};

/** @public */
export type TypedSqlStatement<T = unknown> = {
  /** 单条 SQL 语句片段 */
  readonly sqlStatement: string | Uint8Array;
  /**
   * null 表示 SQL NULL，不进行文本或二进制编码。
   * 参数数量不能超过 65535.
   */
  readonly textArgs?: (string | null)[];

  /**
   * typeID -> ColumnParser
   */
  readonly typeDecoders?: PgDataDecoderMap;
  readonly columnDecoders?: ColumnDecoderMap | ColumnDecoderGetter;
  __infer?(input: T): never;
};

/**
 * 表示可以包含单条 SQL 语句的查询对象
 * @public
 */
export type SqlStatement<T> = TypedSqlStatement<T> | string | Uint8Array;
/**
 * 表示可以包含多条 SQL 语句的查询对象
 * @public
 */
export type SqlStatements =
  | string
  | TypedSqlStatement<unknown>
  | Uint8Array
  | ArrayLike<TypedSqlStatement<unknown> | Uint8Array | string>;

export type QueryResultDecoder<T = unknown> = {
  decode(value: unknown, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
  decodeText(value: string, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
  decodeBinary(value: Uint8Array, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
};
/** @public */
export type ColumnDecoderGetter = (field: FieldInfo, index: number) => ColumnDecoder;
/** @public */
export type ColumnDecoderMap = ReadonlyMap<number, ColumnDecoder>;

/** @public */
export type ColumnDecoder<T = unknown> = {
  decodeText(value: string, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
  decodeBinary(value: Uint8Array, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
};

/**
 * 推断查询结果的类型
 * @public
 */
export type InferQueryResult<T> = T extends { __infer?(v: infer P): never } ? P : unknown;
