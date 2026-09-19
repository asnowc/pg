import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import { createSqlBuilder, JS_DATA_ENCODER_V1 } from "@asla/pg";
const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

test("NULL 无需编码器，保留 Bind null 和 OID 0", async ({ pgPool }) => {
  const sql = createSqlBuilder(new Map());
  const statement = sql`SELECT ${null}::text AS a, ${null}::int AS b`;
  expect(statement.toTemplate()).toBe("SELECT $1::text AS a, $2::int AS b");
  await expect(pgPool.query(statement).getFirstRow()).resolves.toEqual({ a: null, b: null });
});

test("NULL、普通参数和 raw 片段混合时参数编号与 OID 不移位", async ({ pgPool }) => {
  const statement = sql`SELECT ${null}, ${42}, ${sql.raw("CURRENT_DATE")}, ${null}, ${"hello"}, ${null}`;
  expect(statement.toTemplate()).toBe("SELECT $1, $2, CURRENT_DATE, $3, $4, $5");
  const result = await pgPool.query(statement).getFirstRow();
  expect(result).toEqual({ a: null, b: 42, c: expect.any(Date), d: null, e: "hello", f: null });
});

test("空字符串、空字节、零和 false 不会被当作 NULL", async ({ pgPool }) => {
  const statement = sql`SELECT ${""} AS a, ${new Uint8Array()} AS b, ${0} AS c, ${false} AS d, ${null} AS e`;
  expect(statement.toTemplate()).toBe("SELECT $1 AS a, $2 AS b, $3 AS c, $4 AS d, $5 AS e");

  const result = await pgPool.query(statement).getFirstRow();
  expect(result).toEqual({ a: "", b: new Uint8Array(), c: 0, d: false, e: null });
});

test("undefined 仍然报错，包括与 NULL 混用时", () => {
  const list = [
    () => sql`SELECT ${undefined}`,
    () => sql`SELECT ${null}, ${undefined}`,
    () => sql`SELECT ${undefined}, ${null}`,
  ];
  for (const build of list) {
    expect(build).toThrow(TypeError);
    expect(build).toThrow("No PostgreSQL encoder for undefined");
  }
});
