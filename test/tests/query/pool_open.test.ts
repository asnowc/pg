import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("按批读取游标并在完成后归还连接", async ({ pgPool }) => {
  const cursor = await pgPool.open<{ value: number }>("SELECT generate_series(1, 3) AS value", { fetchSize: 1 });

  expect(pgPool.totalCount).toBe(1);
  expect(pgPool.idleCount).toBe(0);
  expect(await cursor.read()).toEqual([{ value: 1 }]);
  expect(cursor.rowsRead).toBe(1);
  expect(await cursor.read(2)).toEqual([{ value: 2 }, { value: 3 }]);
  expect(cursor.rowsRead).toBe(3);
  expect(await cursor.read()).toEqual([]);
  expect(pgPool.idleCount).toBe(1);
});

test("异步迭代完整读取游标并提供完成信息", async ({ pgPool }) => {
  const cursor = await pgPool.open<{ value: number }>("SELECT generate_series(1, 3) AS value", { fetchSize: 2 });

  expect(await Array.fromAsync(cursor)).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);
  expect(await cursor.completion).toEqual({ rowCount: 3, notices: [] });
  expect(cursor.rowsRead).toBe(3);
  expect(pgPool.idleCount).toBe(1);
});

test("显式关闭游标会归还连接且重复关闭安全", async ({ pgPool }) => {
  const cursor = await pgPool.open<{ value: number }>("SELECT generate_series(1, 3) AS value", { fetchSize: 1 });

  expect(await cursor.read()).toEqual([{ value: 1 }]);
  expect(pgPool.idleCount).toBe(0);

  await cursor.close();
  await cursor.close();

  expect(pgPool.idleCount).toBe(1);
  await expect(pgPool.query<{ value: number }>("SELECT 4 AS value").getFirstRow()).resolves.toEqual({ value: 4 });
  expect(pgPool.idleCount).toBe(1);
});

test("异步迭代提前退出会关闭游标并归还连接", async ({ pgPool }) => {
  const cursor = await pgPool.open<{ value: number }>("SELECT generate_series(1, 4) AS value", { fetchSize: 1 });

  for await (const row of cursor) {
    expect(row).toEqual({ value: 1 });
    break;
  }

  expect(pgPool.idleCount).toBe(1);
  await expect(pgPool.query("SELECT 1")).resolves.toBeUndefined();
});

test("打开游标失败后归还连接并可继续查询", async ({ pgPool }) => {
  await expect(pgPool.open("SELECT * FROM missing_pool_open_table")).rejects.toThrow();

  expect(pgPool.idleCount).toBe(pgPool.totalCount);
  await expect(pgPool.query<{ value: number }>("SELECT 1 AS value").getFirstRow()).resolves.toEqual({ value: 1 });
  expect(pgPool.idleCount).toBe(pgPool.totalCount);
});
