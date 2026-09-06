import type { PgDataDecodeContext, PgDataDecoderMap } from "./data_decoder.ts";
import type { FieldInfo } from "./MessageData.ts";

type ListWithLength<T> = ArrayLike<T> | (Iterable<T> & { length: number });

type SqlStatementTextData = string | ArrayLike<string> | Iterable<string>;
type SqlStatementBinaryData = Uint8Array | ArrayLike<Uint8Array> | Iterable<Uint8Array>;

/** @public */
export type SqlStatementData = SqlStatementBinaryData | SqlStatementTextData;

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
export type TypedSqlStatementTemplate<T = unknown> = QueryDecoder<T> & {
  /** 单条 SQL 语句片段 */
  readonly sqlTemplate: SqlStatementData;

  /** 0 为文本格式，1 为二进制格式 */
  readonly argsFormat: 0 | 1 | ListWithLength<0 | 1>;
  readonly argsOid?: ListWithLength<number>;
  readonly args: ListWithLength<Uint8Array | string>;
};

/** @public */
export type TypedSqlStatement<T = unknown> = QueryDecoder<T> & {
  /** 单条 SQL 语句片段 */
  readonly sqlStatement: SqlStatementData;
};

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
