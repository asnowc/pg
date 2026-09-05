import type { PgDataDecodeContext, PgDataDecoderMap } from "./data_decoder.ts";
import type { FieldInfo } from "./MessageData.ts";

type ListWithLength<T> = ArrayLike<T> | (Iterable<T> & { length: number });

type SqlStatementTextData = string | ArrayLike<string> | Iterable<string>;
type SqlStatementBinaryData = Uint8Array | ArrayLike<Uint8Array> | Iterable<Uint8Array>;

export type SqlStatementData = SqlStatementBinaryData | SqlStatementTextData;

export type QueryDecoder<T> = {
  /**
   * typeID -> ColumnParser
   */
  readonly typeDecoders?: PgDataDecoderMap;

  readonly columnDecoders?: ColumnDecoderMap | ColumnDecoderGetter;
  __infer?(input: T): never;
};

export type TypedSqlStatementTemplate<T = unknown> = QueryDecoder<T> & {
  /** 单条 SQL 语句片段 */
  readonly sqlTemplate: SqlStatementData;

  /** 0 为文本格式，1 为二进制格式 */
  readonly argsFormat: 0 | 1 | ListWithLength<0 | 1>;
  readonly argsOid?: ListWithLength<number>;
  readonly args: ListWithLength<Uint8Array | string>;
};

export type TypedSqlStatement<T = unknown> = QueryDecoder<T> & {
  /** 单条 SQL 语句片段 */
  readonly sqlStatement: SqlStatementData;
};

export type ColumnDecoderGetter = (field: FieldInfo) => ColumnDecoder;
export type ColumnDecoderMap = ReadonlyMap<number, ColumnDecoder>;

export type ColumnDecoder<T = unknown> = {
  text(value: string, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
  binary(value: Uint8Array, field: Readonly<FieldInfo> & PgDataDecodeContext): T;
};
