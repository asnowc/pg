import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("查询成功后自动归还连接，且空闲连接会被后续查询复用", async ({ pool }) => {
  await pool.query("SELECT 1");

  expect(pool.totalCount).toBe(1);
  expect(pool.idleCount).toBe(1);

  await pool.query("SELECT 2");

  expect(pool.totalCount).toBe(1);
  expect(pool.idleCount).toBe(1);
});

test("创建 query reader 时不会提前借用连接", async ({ pool }) => {
  const reader = pool.query("SELECT 1");
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);

  await reader;
  expect(pool.totalCount).toBe(1);
  expect(pool.idleCount).toBe(1);
});

test("并发查询在连接池限制内复用可流水线的连接", async ({ pool }) => {
  const queries = Array.from({ length: 8 }, () => pool.query("SELECT 1"));
  await Promise.all(queries);

  expect(pool.totalCount).toBeGreaterThan(0);
  expect(pool.totalCount).toBeLessThanOrEqual(3);
  expect(pool.idleCount).toBe(pool.totalCount);
});

test("SQL 错误后连接池仍可调度后续查询", async ({ pool }) => {
  await expect(pool.query("SELECT * FROM missing_pg_pool_table").rows()).rejects.toThrow();

  await pool.query("SELECT 1");
  expect(pool.idleCount).toBe(1);
});

test("事务内查询与保存点回滚后提交，连接回到池中", async ({ pool }) => {
  await using transaction = pool.begin();
  await transaction.query("CREATE TEMP TABLE queue_transaction_test (value integer)");
  await transaction.savePoint("one");
  await transaction.query("INSERT INTO queue_transaction_test VALUES (1)");
  await transaction.rollbackTo("one");
  await transaction.query("INSERT INTO queue_transaction_test VALUES (2)");
  await transaction.commit();

  expect(await pool.query<{ value: number }>("SELECT value FROM queue_transaction_test").rows())
    .toEqual([{ value: 2 }]);
  expect(pool.idleCount).toBe(1);
});

test("简单查询产生多个结果集并在 ReadyForQuery 后允许新查询", async ({ pool }) => {
  const results = await pool.queryMultiple("SELECT 1 AS value; SELECT 2 AS value").all();

  expect(results).toEqual([[{ value: 1 }], [{ value: 2 }]]);
  await expect(pool.query<{ value: number }>("SELECT 3 AS value").firstRow()).resolves.toEqual({ value: 3 });
});

test("简单查询留下事务时自动回滚并拒绝复用该事务", async ({ pool }) => {
  await expect(async () => {
    await pool.queryMultiple("BEGIN").all();
  }).rejects.toThrow("Simple query left the connection in a transaction");
  await expect(pool.query<{ value: number }>("SELECT 4 AS value").firstRow()).resolves.toEqual({ value: 4 });
});

test("事务查询出错后能回滚到保存点并继续执行", async ({ pool }) => {
  await using transaction = pool.begin();
  await transaction.savePoint("before_error");
  await expect(transaction.query("SELECT 1 / 0")).rejects.toThrow();
  await transaction.rollbackTo("before_error");
  await expect(transaction.query<{ value: number }>("SELECT 5 AS value").firstRow())
    .resolves.toEqual({ value: 5 });
  await transaction.commit();
});

test("默认禁用空闲超时，连接可供下一次查询复用", async ({ pool }) => {
  await pool.query("SELECT 1");
  expect(pool.idleCount).toBe(1);

  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(pool.totalCount).toBe(1);
  expect(pool.idleCount).toBe(1);
});
