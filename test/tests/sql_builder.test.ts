import { expect, test } from "vitest";
import { createSqlBuilder, JS_DATA_ENCODER_V1, type TypedSqlStatementTemplate } from "@asla/pg";
import { PgOid } from "@/util/pg_oid.ts";

const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

test("NULL 无需编码器，保留 Bind null 和 OID 0", () => {
  const sql = createSqlBuilder(new Map());
  const statement = sql`SELECT ${null}::text, ${null}::int`;
  const typed: TypedSqlStatementTemplate = statement;
  expect(statement.toTemplate()).toBe("SELECT $1::text, $2::int");
  expect(typed.args).toEqual([null, null]);
  expect(typed.argsOid).toEqual([0, 0]);
  expect(typed.argsFormat).toBe(1);
});

test("NULL、普通参数和 raw 片段混合时参数编号与 OID 不移位", () => {
  const statement = sql`SELECT ${null}, ${42}, ${sql.raw("CURRENT_DATE")}, ${null}, ${"hello"}, ${null}`;
  expect(statement.toTemplate()).toBe("SELECT $1, $2, CURRENT_DATE, $3, $4, $5");
  expect(statement.args).toEqual([null, Uint8Array.of(0, 0, 0, 42), null, new TextEncoder().encode("hello"), null]);
  expect(statement.argsOid).toEqual([0, PgOid.INT4, 0, PgOid.TEXT, 0]);
});

test("空字符串、空字节、零和 false 不会被当作 NULL", () => {
  const statement = sql`SELECT ${""}, ${new Uint8Array()}, ${0}, ${false}, ${null}`;
  expect(statement.toTemplate()).toBe("SELECT $1, $2, $3, $4, $5");
  expect(statement.args).toEqual([
    new Uint8Array(),
    new Uint8Array(),
    Uint8Array.of(0, 0, 0, 0),
    Uint8Array.of(0),
    null,
  ]);
  expect(statement.argsOid).toEqual([PgOid.TEXT, PgOid.BYTEA, PgOid.INT4, PgOid.BOOL, 0]);
});

test("undefined 仍然报错，包括与 NULL 混用时", () => {
  for (
    const build of [
      () => sql`SELECT ${undefined}`,
      () => sql`SELECT ${null}, ${undefined}`,
      () => sql`SELECT ${undefined}, ${null}`,
    ]
  ) {
    expect(build).toThrow(TypeError);
    expect(build).toThrow("No PostgreSQL encoder for undefined");
  }
});
