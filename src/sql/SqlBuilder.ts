import type { JsDataEncoder, JSDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";

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
export interface SqlGenerator extends SqlGeneratorPrototype {
  <T = unknown>(chunks: TemplateStringsArray, ...args: unknown[]): TypedSqlStatement<T>;
  raw(value: string): String;
}
interface SqlGeneratorPrototype {
  /**
   * @example
   *  import { sql } from "@asla/pg";
   *  const statement = sql`SELECT * FROM ${sql.raw("t1")} WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
   *  console.log(statement.toTemplate(), statement.textArgs);
   */
  raw(value: string): String;
}

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
export function createSqlBuilder(chunksOrMap: JSDataEncoderMap): SqlGenerator {
  function sqlBuilder<T = unknown>(chunks: TemplateStringsArray, ...args: unknown[]): TypedTemplateSqlStatement<T> {
    return createTypedTemplateSqlStatement<T>(chunks, args, chunksOrMap);
  }
  sqlBuilder.raw = sqlGeneratorPrototype.raw;
  return sqlBuilder;
}
const sqlGeneratorPrototype: SqlGeneratorPrototype = {
  raw(value: string): String {
    return new String(value);
  },
};

let createTypedTemplateSqlStatement: <T>(
  chunks: TemplateStringsArray,
  args: unknown[],
  chunksOrMap: JSDataEncoderMap,
) => TypedTemplateSqlStatement<T>;
/**
 * @public
 */
export class TypedTemplateSqlStatement<T = unknown> extends TypedSqlStatement<T> {
  static #createTypedTemplateSqlStatement<T>(
    chunks: TemplateStringsArray,
    args: unknown[],
    chunksOrMap: JSDataEncoderMap,
  ) {
    return new TypedTemplateSqlStatement<T>(chunks, args, chunksOrMap);
  }
  static {
    createTypedTemplateSqlStatement = this.#createTypedTemplateSqlStatement;
  }
  private constructor(
    chunks: TemplateStringsArray,
    args: unknown[],
    chunksOrMap: JSDataEncoderMap,
  ) {
    super(chunks, args, args ? getEncoders(args, chunksOrMap) : undefined);
    this.#chunks = chunks;
  }
  #chunks: TemplateStringsArray;
  #sql?: string;
  toSql(): string {
    if (!this.#sql) {
      this.#sql = templateStringsArrayToSql(this.#chunks, this.args ?? [], this.argsEncoders ?? []);
    }
    return this.#sql;
  }
  override toString(): string {
    return this.toSql();
  }
}
function getEncoders(args: unknown[], encoder: JSDataEncoderMap): JsDataEncoder[] {
}
function templateStringsArrayToSql(chunks: TemplateStringsArray, args: unknown[], encoders: JsDataEncoder[]) {
  let template = chunks[0];
  let arg: unknown;
  for (let i = 1; i < chunks.length; i++) {
    arg = args[i - 1];
    if (arg === null) template += "NULL";
    else {
      const encoder = encoders[i - 1];
      template += encoder.encodeToText(arg);
    }
    template += chunks[i];
  }
  return template;
}
