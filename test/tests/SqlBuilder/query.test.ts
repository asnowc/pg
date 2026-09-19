import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import { createSqlBuilder, JS_DATA_ENCODER_V1 } from "@asla/pg";
const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

type QueryResult = {
  value: number;
  nullable: string | null;
  empty: string;
  number: number;
};
test("模板字符串查询", async ({ connect }) => {
  const statement = sql<QueryResult>`
    SELECT 
      ${"42"}::int AS value,
      ${null}::text AS nullable,
      ${""}::text AS empty,
      ${"123"}::int AS number`;

  await expect(connect.query(statement).getFirstRow()).resolves.toEqual({
    value: 42,
    nullable: null,
    empty: "",
    number: 123,
  });
});

test("查询函数", async ({ connect }) => {
  const getData = create((input: { value: string; nullable: string | null; empty: string; number: string }) => {
    return sql<QueryResult>`
      SELECT 
        ${input.value}::int AS value,
        ${input.nullable}::text AS nullable,
        ${input.empty}::text AS empty,
        ${input.number}::int AS number`;
  });

  const row = await connect.query(getData({ value: "42", nullable: null, empty: "", number: "123" })).getFirstRow();

  expect(row).toEqual({ value: 42, nullable: null, empty: "", number: 123 });
});
declare function create<T extends {}, R>(
  fn: (input: T) => R,
): (input: T) => R;
