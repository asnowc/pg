import { expect, expectTypeOf } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("rows 返回所有行", async ({ conn }) => {
  const result = await conn.query<{ value: number }>("SELECT 3 AS value").rows();
  expect(result).toEqual([{ value: 3 }]);
  expectTypeOf(result).toEqualTypeOf<Array<{ value: number }>>();
  await expect(conn.query("SELECT 1 AS value WHERE false").rows()).resolves.toEqual([]);
});
test("firstRow 返回首行", async ({ conn }) => {
  const result = await conn.query<{ value: number }>("SELECT 3 AS value").firstRow();
  expect(result).toEqual({ value: 3 });
  expectTypeOf(result).toEqualTypeOf<{ value: number } | null>();

  await expect(conn.query("SELECT 1 AS value WHERE false").firstRow()).resolves.toBeNull();
  await expect(conn.query("SELECT generate_series(1, 4) AS value").firstRow()).resolves.toEqual({ value: 1 });
});
test("rowCount 返回 CommandComplete 中的行数", async ({ conn }) => {
  await expect(conn.query("SELECT generate_series(1, 4)").rowCount()).resolves.toBe(4);
  await expect(conn.query("SELECT 1 AS value WHERE false").rowCount()).resolves.toBe(0);
});
test("getResults 返回行、字段和完成信息", async ({ conn }) => {
  const sql = "SELECT 7 AS value, 'seven' AS label";
  const result = await conn.query<{ value: number; label: string }>(sql).results();

  expect(result.rows).toEqual([{ value: 7, label: "seven" }]);
  expect(result.rowCount).toBe(1);
  expect(result.notices).toEqual([]);
  expect(result.fields).toMatchObject([
    expect.objectContaining({ index: 0, name: "value" }),
    expect.objectContaining({ index: 1, name: "label" }),
  ]);
});

test("getMap 使用指定字段构建映射", async ({ conn }) => {
  const sql = "SELECT * FROM (VALUES (1, 'one'), (2, 'two')) AS values(id, value)";
  const rows = await conn.query<{ id: number; value: string }>(sql).map("id");
  expect(rows).toEqual(new Map([[1, { id: 1, value: "one" }], [2, { id: 2, value: "two" }]]));
});

test("异步迭代逐行返回数据并返回完成信息", async ({ conn }) => {
  const sql = "SELECT generate_series(1, 2) AS value";
  const iterator = conn.query<{ value: number }>(sql)[Symbol.asyncIterator]();
  await expect(iterator.next()).resolves.toEqual({ done: false, value: { value: 1 } });
  await expect(iterator.next()).resolves.toEqual({ done: false, value: { value: 2 } });
  await expect(iterator.next()).resolves.toEqual({ done: true, value: { rowCount: 2, notices: [] } });

  const list = await Array.fromAsync(conn.query<{ value: number }>(sql));
  expect(list).toEqual([{ value: 1 }, { value: 2 }]);
});

test("QueryReader 只能消费一次", async ({ conn }) => {
  const reader = conn.query<{ value: number }>("SELECT 1 AS value");

  const r1 = reader.rows();
  const r2 = reader.rowCount();
  r2.catch(() => {});
  await expect(r1).resolves.toEqual([{ value: 1 }]);
  await expect(r2).rejects.toThrow("QueryReader has already been consumed");
});

test("执行两条查询", async ({ conn }) => {
  const result1 = await conn.query("SELECT 1 AS value").firstRow();
  const result2 = await conn.query("SELECT 2 AS value").firstRow();
  expect(result1).toEqual({ value: 1 });
  expect(result2).toEqual({ value: 2 });
});
test("执行孤立的流水线查询", async ({ conn }) => {
  const results = await Promise.all([
    conn.query("SELECT 1 AS value").firstRow(),
    conn.query("SELECT 2 AS value").firstRow(),
    conn.query("SELECT 3 AS value").firstRow(),
  ]);
  expect(results[0]).toEqual({ value: 1 });
  expect(results[1]).toEqual({ value: 2 });
  expect(results[2]).toEqual({ value: 3 });
});
