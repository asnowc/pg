import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("查询成功后自动归还连接", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");

  expect(pgPool.totalCount).toBe(1);
  expect(pgPool.idleCount).toBe(1);
});

test("创建 query reader 时不会提前借用连接", async ({ pgPool }) => {
  const reader = pgPool.query("SELECT 1");
  expect(pgPool.totalCount).toBe(0);
  expect(pgPool.idleCount).toBe(0);

  await reader;
  expect(pgPool.totalCount).toBe(1);
  expect(pgPool.idleCount).toBe(1);
});

test("空闲连接会被后续查询复用", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");
  const totalCount = pgPool.totalCount;

  await pgPool.query("SELECT 2");
  expect(pgPool.totalCount).toBe(totalCount);
  expect(pgPool.idleCount).toBe(1);
});

test("并发查询在连接池限制内复用可流水线的连接", async ({ pgPool }) => {
  const queries = Array.from({ length: 8 }, () => pgPool.query("SELECT 1"));
  await Promise.all(queries);

  expect(pgPool.totalCount).toBeGreaterThan(0);
  expect(pgPool.totalCount).toBeLessThanOrEqual(3);
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});

test("SQL 错误后连接池仍可调度后续查询", async ({ pgPool }) => {
  await expect(pgPool.query("SELECT * FROM missing_pg_pool_table").getRows()).rejects.toThrow();

  await pgPool.query("SELECT 1");
  expect(pgPool.idleCount).toBe(1);
});

test("事务内查询与保存点回滚后提交，连接回到池中", async ({ pgPool }) => {
  await using transaction = pgPool.begin();
  await transaction.query("CREATE TEMP TABLE queue_transaction_test (value integer)");
  await transaction.savePoint("one");
  await transaction.query("INSERT INTO queue_transaction_test VALUES (1)");
  await transaction.rollbackTo("one");
  await transaction.query("INSERT INTO queue_transaction_test VALUES (2)");
  await transaction.commit();

  expect(await pgPool.query<{ value: number }>("SELECT value FROM queue_transaction_test").getRows())
    .toEqual([{ value: 2 }]);
  expect(pgPool.idleCount).toBe(1);
});

test("简单查询产生多个结果集并在 ReadyForQuery 后允许新查询", async ({ pgPool }) => {
  const results = [];
  for await (const result of pgPool.simpleQuery("SELECT 1 AS value; SELECT 2 AS value")) {
    results.push(result.rows);
  }
  expect(results).toEqual([[{ value: 1 }], [{ value: 2 }]]);
  await expect(pgPool.query<{ value: number }>("SELECT 3 AS value").getFirstRow()).resolves.toEqual({ value: 3 });
});

test("简单查询留下事务时自动回滚并拒绝复用该事务", async ({ pgPool }) => {
  await expect(async () => {
    for await (const _result of pgPool.simpleQuery("BEGIN")) { /* drain */ }
  }).rejects.toThrow("Simple query left the connection in a transaction");
  await expect(pgPool.query<{ value: number }>("SELECT 4 AS value").getFirstRow()).resolves.toEqual({ value: 4 });
});

test("事务查询出错后能回滚到保存点并继续执行", async ({ pgPool }) => {
  await using transaction = pgPool.begin();
  await transaction.savePoint("before_error");
  await expect(transaction.query("SELECT 1 / 0")).rejects.toThrow();
  await transaction.rollbackTo("before_error");
  await expect(transaction.query<{ value: number }>("SELECT 5 AS value").getFirstRow())
    .resolves.toEqual({ value: 5 });
  await transaction.commit();
});

test("默认禁用空闲超时，连接可供下一次查询复用", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");
  expect(pgPool.idleCount).toBe(1);

  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(pgPool.totalCount).toBe(1);
  expect(pgPool.idleCount).toBe(1);
});

test("close 会等待在途查询完成，并拒绝后续查询", async ({ pgPool }) => {
  const running = pgPool.query("SELECT 1 FROM pg_sleep(0.02)").getRows();
  const closing = pgPool.close();

  await expect(pgPool.query("SELECT 1")).rejects.toThrow("Pool is closed");
  await running;
  await expect(closing).resolves.toBeUndefined();
});
test("destroy 会立即销毁所有连接并释放资源", async function ({ pgPool }) {
  const running = pgPool.query("SELECT 1 FROM pg_sleep(0.02)").getRows();
  pgPool.destroy();

  await expect(pgPool.query("SELECT 1")).rejects.toThrow("Pool is destroyed");
  await expect(running).rejects.toThrow("Pool is destroyed");
});
