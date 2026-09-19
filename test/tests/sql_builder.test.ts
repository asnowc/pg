import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import { createSqlBuilder, JS_DATA_ENCODER_V1 } from "@asla/pg";
const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

test("NULL 无需编码器，保留 Bind null 和 OID 0", async ({ pgPool }) => {
  const sql = createSqlBuilder(new Map());
  const statement = sql`SELECT ${null}::text, ${null}::int`;
  expect(statement.toTemplate()).toBe("SELECT $1::text, $2::int");
  await expect(pgPool.query(statement).getFirstRow()).resolves.toEqual([null, null]);
});

test("NULL、普通参数和 raw 片段混合时参数编号与 OID 不移位", async ({ pgPool }) => {
  const statement = sql`SELECT ${null}, ${42}, ${sql.raw("CURRENT_DATE")}, ${null}, ${"hello"}, ${null}`;
  expect(statement.toTemplate()).toBe("SELECT $1, $2, CURRENT_DATE, $3, $4, $5");
  const result = await pgPool.query(statement).getFirstRow();
  expect(result).toEqual([null, 42, expect.any(Date), null, "hello", null]);
});

test("空字符串、空字节、零和 false 不会被当作 NULL", async ({ pgPool }) => {
  const statement = sql`SELECT ${""}, ${new Uint8Array()}, ${0}, ${false}, ${null}`;
  expect(statement.toTemplate()).toBe("SELECT $1, $2, $3, $4, $5");

  const result = await pgPool.query(statement).getFirstRow();
  expect(result).toEqual(["", new Uint8Array(), 0, false, null]);
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
