import type { JSDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { createTypedTemplateSqlStatement, TypedTemplateSqlStatement } from "./TypedTemplateSqlStatement.ts";
import { PgColumnDecoder } from "@/interface/pg_data_decoder.ts";

/**
 * @example
 *  import { sql, PgConnection } from "@asla/pg";
 *  declare const conn: PgConnection;
 *
 *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
 *  const rows = await conn.query(statement).rows();
 *
 *  console.log(statement.toTemplate(), statement.args);
 * @public
 * @since 0.2.5
 */
export interface SqlGenerator extends SqlGeneratorPrototype {
  <T = unknown>(chunks: TemplateStringsArray, ...args: unknown[]): TypedTemplateSqlStatement<T>;
  raw(value: string): String;
}
/**
 * @since 0.2.5
 */
interface SqlGeneratorPrototype {
  /**
   * @example
   *  import { sql } from "@asla/pg";
   *  const statement = sql`SELECT * FROM ${sql.raw("t1")} WHERE id = ${"1"}`;  // SELECT * FROM t1 WHERE id = $1 , ["'1'"]
   *  console.log(statement.toTemplate(), statement.args);
   */
  raw(value: string): String;
}

/**
 * @example
 *  import { JS_DATA_ENCODER_V1, createSqlBuilder, PgConnection } from "@asla/pg";
 *  declare const conn: PgConnection;
 *  const sql = createSqlBuilder(JS_DATA_ENCODER_V1);
 *
 *  const statement = sql`SELECT * FROM t1 WHERE id = ${"1"}`;
 *  const rows = await conn.query(statement).rows();
 *  console.log(statement.toTemplate(), statement.args); // SELECT * FROM t1 WHERE id = $1 , ["1"]
 * @public
 * @since 0.2.5
 */
export function createSqlBuilder(
  encoderMap: JSDataEncoderMap,
  decoderMap: ReadonlyMap<number, PgColumnDecoder<unknown>>,
): SqlGenerator {
  if (!(encoderMap instanceof Map)) {
    throw new TypeError("No encoder map provided");
  }
  if (!(decoderMap instanceof Map)) {
    throw new TypeError("No decoder map provided");
  }
  function sqlBuilder<T = unknown>(chunks: TemplateStringsArray, ...args: unknown[]): TypedTemplateSqlStatement<T> {
    return createTypedTemplateSqlStatement<T>(chunks, args, encoderMap, decoderMap);
  }
  sqlBuilder.raw = sqlGeneratorPrototype.raw;
  return sqlBuilder;
}
const sqlGeneratorPrototype: SqlGeneratorPrototype = {
  raw(value: string): String {
    return new String(value);
  },
};
export { TypedTemplateSqlStatement };
