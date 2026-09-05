import type { TypedSqlStatement, TypedSqlStatementTemplate } from "../driver/query/QueryStatement.ts";

export type JsDataEncoder<T = unknown> = {
  getOid(value: T): number;
  text(value: T, oid: number): string;
  binary(value: T, oid: number): Uint8Array;
};

export declare const JS_DATA_ENCODER_V1: JsDataEncoderMap;

export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder>;
const DATA_TYPE_KEY = Symbol("Data type key");

export function setJsDataTypeFlag<T extends object>(obj: T, flag: string | number): T {
  Reflect.set(obj, DATA_TYPE_KEY, flag);
  return obj;
}

export declare function getJsDataEncoder(map: JsDataEncoderMap, data: unknown): JsDataEncoder | undefined;

export declare class SqlStatementTemplate<T = unknown> implements TypedSqlStatementTemplate<T>, TypedSqlStatement<T> {
  constructor(chunks: TemplateStringsArray, args: unknown[], encoderMap: JsDataEncoderMap);
  get sqlTemplate(): ReadonlyArray<string>;
  get sqlStatement(): ReadonlyArray<string>;
  readonly argsFormat: 1;
  get argsOid(): ReadonlyArray<number> | undefined;
  get args(): ReadonlyArray<Uint8Array>;

  /**
   * @example
   *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`.setDecoder<{ id: number }>(decoder);
   */
  setDecoder<T>(): SqlStatementTemplate<T>;
  toTemplate(): string;
  toString(): string;
}
export interface SqlStatementTemplate<T = unknown> {
  __infer(input: T): never;
}

type SqlGenerator = (chunks: TemplateStringsArray, ...args: unknown[]) => SqlStatementTemplate;

/**
 * @example
 *  import { JS_DATA_ENCODER_V1, sql as defaultSql, PgConnection } from "@asla/pg";
 *  declare const conn: PgConnection;
 *  const sql = defaultSql(JS_DATA_ENCODER_V1);
 *
 *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`;
 *  const rows = await conn.query(statement);
 *  console.log(statement.toTemplate(), statement.textArgs); // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
 */
export declare function sql(encoderMap: JsDataEncoderMap): SqlGenerator;
/**
 * @example
 *  import { sql, PgConnection } from "@asla/pg";
 *  declare const conn: PgConnection;
 *
 *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
 *  const rows = await conn.query(statement);
 *
 *  console.log(statement.toTemplate(), statement.textArgs);
 */
export declare function sql(chunks: TemplateStringsArray, ...args: unknown[]): SqlStatementTemplate;

/**
 * @example
 *  import { sql } from "@asla/pg";
 *  const statement = sql`SELECT * FROM ${sql.raw("t1")} WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
 *  console.log(statement.toTemplate(), statement.textArgs);
 */
sql.raw = function sqlRaw(value: string) {
  return new String(value);
};
