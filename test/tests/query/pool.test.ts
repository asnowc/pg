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

test("顺序读取复用已归还的连接", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");
  const totalCount = pgPool.totalCount;

  await pgPool.query("SELECT 2").rows();

  expect(pgPool.totalCount).toBe(totalCount);
  expect(pgPool.idleCount).toBe(totalCount);
});

test("SQL 错误后归还连接并可继续查询", async ({ pgPool }) => {
  await expect(pgPool.query("SELECT * FROM missing_pool_query_table").rows()).rejects.toThrow();

  expect(pgPool.idleCount).toBe(pgPool.totalCount);
  await expect(pgPool.query<{ value: number }>("SELECT 1 AS value").firstRow()).resolves.toEqual({ value: 1 });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});
