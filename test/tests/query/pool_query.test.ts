import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("创建 QueryReader 时不会提前借用连接", async ({ pgPool }) => {
  const reader = pgPool.query("SELECT 1");

  expect(pgPool.totalCount).toBe(0);
  expect(pgPool.idleCount).toBe(0);

  await reader;

  expect(pgPool.totalCount).toBe(1);
  expect(pgPool.idleCount).toBe(1);
});

test("getRows 返回全部行并归还连接", async ({ pgPool }) => {
  const rows = await pgPool.query<{ value: number }>("SELECT 1 AS value UNION ALL SELECT 2 ORDER BY value").getRows();

  expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("getFirstRow 返回首行或 null 并归还连接", async ({ pgPool }) => {
  await expect(pgPool.query<{ value: number }>("SELECT 3 AS value").getFirstRow()).resolves.toEqual({ value: 3 });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);

  await expect(pgPool.query<{ value: number }>("SELECT 1 AS value WHERE false").getFirstRow()).resolves.toBeNull();
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("getRowCount 返回 CommandComplete 中的行数", async ({ pgPool }) => {
  await expect(pgPool.query("SELECT generate_series(1, 4)").getRowCount()).resolves.toBe(4);
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("getResults 返回行、字段和完成信息", async ({ pgPool }) => {
  const result = await pgPool.query<{ value: number; label: string }>(
    "SELECT 7 AS value, 'seven' AS label",
  ).getResults();

  expect(result.rows).toEqual([{ value: 7, label: "seven" }]);
  expect(result.rowCount).toBe(1);
  expect(result.notices).toEqual([]);
  expect(result.fields).toEqual([
    expect.objectContaining({ index: 0, name: "value" }),
    expect.objectContaining({ index: 1, name: "label" }),
  ]);
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("getMap 使用指定字段构建映射", async ({ pgPool }) => {
  const rows = await pgPool.query<{ id: number; value: string }>(
    "SELECT * FROM (VALUES (1, 'one'), (2, 'two')) AS values(id, value)",
  ).getMap("id");

  expect(rows).toEqual(new Map([
    [1, { id: 1, value: "one" }],
    [2, { id: 2, value: "two" }],
  ]));
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("异步迭代逐行返回数据并返回完成信息", async ({ pgPool }) => {
  const iterator = pgPool.query<{ value: number }>(
    "SELECT generate_series(1, 2) AS value",
  )[Symbol.asyncIterator]();

  await expect(iterator.next()).resolves.toEqual({ done: false, value: { value: 1 } });
  await expect(iterator.next()).resolves.toEqual({ done: false, value: { value: 2 } });
  await expect(iterator.next()).resolves.toEqual({ done: true, value: { rowCount: 2, notices: [] } });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("QueryReader 只能消费一次", async ({ pgPool }) => {
  const reader = pgPool.query<{ value: number }>("SELECT 1 AS value");

  await expect(reader.getRows()).resolves.toEqual([{ value: 1 }]);
  await expect(reader.getRowCount()).rejects.toThrow("QueryReader has already been consumed");
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("顺序读取复用已归还的连接", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");
  const totalCount = pgPool.totalCount;

  await pgPool.query("SELECT 2").getRows();

  expect(pgPool.totalCount).toBe(totalCount);
  expect(pgPool.idleCount).toBe(totalCount);
});

test("SQL 错误后归还连接并可继续查询", async ({ pgPool }) => {
  await expect(pgPool.query("SELECT * FROM missing_pool_query_table").getRows()).rejects.toThrow();

  expect(pgPool.idleCount).toBe(pgPool.totalCount);
  await expect(pgPool.query<{ value: number }>("SELECT 1 AS value").getFirstRow()).resolves.toEqual({ value: 1 });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});
