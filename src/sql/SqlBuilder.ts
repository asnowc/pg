import type { JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
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
export function createSqlBuilder(chunksOrMap: JsDataEncoderMap): SqlGenerator {
  function sqlBuilder<T = unknown>(chunks: TemplateStringsArray, ...args: unknown[]): TypedSqlStatement<T> {
    return new TypedSqlStatement(chunks, args, chunksOrMap as JsDataEncoderMap);
  }
  sqlBuilder.raw = sqlGeneratorPrototype.raw;
  return sqlBuilder;
}
const sqlGeneratorPrototype: SqlGeneratorPrototype = {
  raw(value: string): String {
    return new String(value);
  },
};
