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

test("终结读取方法返回查询结果并归还连接", async ({ pgPool }) => {
  const rows = await pgPool.query<{ value: number }>("SELECT 1 AS value UNION ALL SELECT 2 ORDER BY value").getRows();
  expect(rows).toEqual([{ value: 1 }, { value: 2 }]);
  expect(pgPool.idleCount).toBe(pgPool.totalCount);

  const firstRow = await pgPool.query<{ value: number }>("SELECT 3 AS value").getFirstRow();
  expect(firstRow).toEqual({ value: 3 });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);

  const rowCount = await pgPool.query("SELECT generate_series(1, 4)").getRowCount();
  expect(rowCount).toBe(4);
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("顺序查询复用已归还的连接", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");
  const totalCount = pgPool.totalCount;

  await pgPool.query("SELECT 2");

  expect(pgPool.totalCount).toBe(totalCount);
  expect(pgPool.idleCount).toBe(totalCount);
});

test("SQL 错误后归还连接并可继续查询", async ({ pgPool }) => {
  await expect(pgPool.query("SELECT * FROM missing_pool_query_table").getRows()).rejects.toThrow();

  expect(pgPool.idleCount).toBe(pgPool.totalCount);
  await expect(pgPool.query<{ value: number }>("SELECT 1 AS value").getFirstRow()).resolves.toEqual({ value: 1 });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});
