import type { TypedSqlStatement, TypedSqlStatementTemplate } from "../query/QueryStatement.ts";

/** @public */
export type JsDataEncoder<T = unknown> = {
  getOid(value: T): number;
  text(value: T, oid: number): string;
  binary(value: T, oid: number): Uint8Array;
};

const encoder = new TextEncoder();
const stringEncoder: JsDataEncoder<string> = {
  getOid: () => 25,
  text: String,
  binary: (value) => encoder.encode(value),
};
const numberEncoder: JsDataEncoder<number> = {
  getOid: (value) => Number.isInteger(value) ? 23 : 701,
  text: String,
  binary(value, oid) {
    const output = new Uint8Array(oid === 23 ? 4 : 8);
    const view = new DataView(output.buffer);
    oid === 23 ? view.setInt32(0, value) : view.setFloat64(0, value);
    return output;
  },
};
const booleanEncoder: JsDataEncoder<boolean> = {
  getOid: () => 16,
  text: (value) => value ? "true" : "false",
  binary: (value) => Uint8Array.of(value ? 1 : 0),
};
const bytesEncoder: JsDataEncoder<Uint8Array> = {
  getOid: () => 17,
  text: (value) => `\\x${toHex(value)}`,
  binary: (value) => value,
};
const dateEncoder: JsDataEncoder<Date> = {
  getOid: () => 1184,
  text: (value) => value.toISOString(),
  binary: (value) => encoder.encode(value.toISOString()),
};

/** @public */
export const JS_DATA_ENCODER_V1: JsDataEncoderMap = new Map<object | string | number, JsDataEncoder>([
  ["string", stringEncoder],
  ["number", numberEncoder],
  ["boolean", booleanEncoder],
  [Uint8Array, bytesEncoder],
  [Date, dateEncoder],
]);

/** @public */
export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder>;
const DATA_TYPE_KEY = Symbol("Data type key");

/** @public */
export function setJsDataTypeFlag<T extends object>(obj: T, flag: string | number): T {
  Reflect.set(obj, DATA_TYPE_KEY, flag);
  return obj;
}

/** @public */
export function getJsDataEncoder(map: JsDataEncoderMap, data: unknown): JsDataEncoder | undefined {
  if (data === null || data === undefined) return undefined;
  if (typeof data === "object") {
    const flag = Reflect.get(data, DATA_TYPE_KEY) as string | number | undefined;
    return map.get(flag ?? data.constructor);
  }
  return map.get(typeof data);
}

/** @public */
export class SqlStatementTemplate<T = unknown> implements TypedSqlStatementTemplate<T>, TypedSqlStatement<T> {
  constructor(private chunks: TemplateStringsArray, values: unknown[], encoderMap: JsDataEncoderMap) {
    const sql: string[] = [chunks[0]];
    const args: Uint8Array[] = [];
    const oids: number[] = [];
    for (let index = 0; index < values.length; index++) {
      const value = values[index];
      if (value instanceof String) {
        sql.push(String(value), chunks[index + 1]);
        continue;
      }
      const dataEncoder = getJsDataEncoder(encoderMap, value);
      if (!dataEncoder) throw new TypeError(`No PostgreSQL encoder for ${value === null ? "null" : typeof value}`);
      const oid = dataEncoder.getOid(value);
      args.push(dataEncoder.binary(value, oid));
      oids.push(oid);
      sql.push(`$${args.length}`, chunks[index + 1]);
    }
    this.#sql = sql;
    this.args = args;
    this.argsOid = oids;
  }
  #sql: string[];
  get sqlTemplate(): ReadonlyArray<string> {
    return this.#sql;
  }
  get sqlStatement(): ReadonlyArray<string> {
    return this.#sql;
  }
  readonly argsFormat = 1 as const;
  readonly argsOid: ReadonlyArray<number>;
  readonly args: ReadonlyArray<Uint8Array>;

  /**
   * @example
   *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`.setDecoder<{ id: number }>(decoder);
   */
  setDecoder<U>(): SqlStatementTemplate<U> {
    return this as unknown as SqlStatementTemplate<U>;
  }
  toTemplate(): string {
    return this.#sql.join("");
  }
  toString(): string {
    return this.toTemplate();
  }
}
/** @public */
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
 * @public
 */
export function sql(encoderMap: JsDataEncoderMap): SqlGenerator;
/**
 * @example
 *  import { sql, PgConnection } from "@asla/pg";
 *  declare const conn: PgConnection;
 *
 *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
 *  const rows = await conn.query(statement);
 *
 *  console.log(statement.toTemplate(), statement.textArgs);
 * @public
 */
export function sql(chunks: TemplateStringsArray, ...args: unknown[]): SqlStatementTemplate;
/** @public */
export function sql(
  chunksOrMap: TemplateStringsArray | JsDataEncoderMap,
  ...args: unknown[]
): SqlStatementTemplate | SqlGenerator {
  if (!Array.isArray(chunksOrMap)) {
    return (chunks, ...values) => new SqlStatementTemplate(chunks, values, chunksOrMap as JsDataEncoderMap);
  }
  return new SqlStatementTemplate(chunksOrMap as TemplateStringsArray, args, JS_DATA_ENCODER_V1);
}

/**
 * @example
 *  import { sql } from "@asla/pg";
 *  const statement = sql`SELECT * FROM ${sql.raw("t1")} WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
 *  console.log(statement.toTemplate(), statement.textArgs);
 */
sql.raw = function sqlRaw(value: string): String {
  return new String(value);
};

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
