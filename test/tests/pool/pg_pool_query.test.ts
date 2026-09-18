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

test("并发查询不会超过连接池最大数量", async ({ pgPool }) => {
  const queries = Array.from({ length: 8 }, () => pgPool.query("SELECT 1"));
  await Promise.all(queries);

  expect(pgPool.totalCount).toBe(4);
  expect(pgPool.idleCount).toBe(4);
});

test("SQL 错误后连接池仍可调度后续查询", async ({ pgPool }) => {
  await expect(pgPool.query("SELECT * FROM missing_pg_pool_table").getRows()).rejects.toThrow();

  await pgPool.query("SELECT 1");
  expect(pgPool.idleCount).toBe(1);
});

test("空闲连接在 idleTimeout 到期后被回收", async ({ pgPool }) => {
  await pgPool.query("SELECT 1");
  expect(pgPool.idleCount).toBe(1);

  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(pgPool.totalCount).toBe(0);
  expect(pgPool.idleCount).toBe(0);
});

test("close 会等待在途查询完成，并拒绝后续查询", async ({ pgPool }) => {
  const running = pgPool.query("SELECT pg_sleep(0.02)");
  const closing = pgPool.close();

  await expect(pgPool.query("SELECT 1")).rejects.toThrow("Pool is closed");
  await running;
  await expect(closing).resolves.toBeUndefined();
});
test("destroy 会立即销毁所有连接并释放资源", async function ({ pgPool }) {
  const running = pgPool.query("SELECT pg_sleep(0.02)");
  pgPool.destroy();

  await expect(pgPool.query("SELECT 1")).rejects.toThrow("Pool is closed");
  await expect(running).rejects.toThrow("Pool has been destroyed");
});
