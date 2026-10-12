import { createConn, test } from "@test/fixtures/db_connect.ts";
import { expect } from "vitest";

const CLOSE_MESSAGE = "The PostgreSQL session has been closed";
const DESTROY_MESSAGE = "The PostgreSQL session has been destroyed";

test("重复关闭已关闭的连接会被忽略", async () => {
  await using conn = await createConn();
  await conn.close();
  expect(conn.closed).toBe(true);
  await conn.close();
  expect(conn.closed).toBe(true);

  await using conn2 = await createConn();
  await Promise.all([conn2.close(), conn2.close()]);
  expect(conn2.closed).toBe(true);
});
test("关闭连接会等待查询响应完毕后再关闭，关闭后再执行查询会报错", async () => {
  await using conn = await createConn();

  const count = conn.query("SELECT pg_sleep(1)").rowCount();
  const r1 = conn.query("SELECT 1 AS v").firstRow();
  const r2 = conn.query("SELECT 2 AS v").firstRow();
  const close = conn.close();
  const r3 = conn.query("SELECT 3 AS v").firstRow().catch((e) => e);
  Promise.allSettled([count, r1, r2, close, r3]); // 防止 unhandled promise rejection

  await expect(count).resolves.toBe(1);
  expect(conn.closed).toBe(true);

  await expect(r1).resolves.toEqual({ v: 1 });
  await expect(r2).resolves.toEqual({ v: 2 });
  await expect(r3, "关闭连接后再执行查询会报错").rejects.toThrow(CLOSE_MESSAGE);

  await expect(conn.query("SELECT 4 AS v").firstRow()).rejects.toThrow(CLOSE_MESSAGE);
});

test("重复销毁连接将被忽略，销毁后再执行查询会报错", async () => {
  await using conn = await createConn();
  conn.destroy();
  expect(conn.closed).toBe(true);
  conn.destroy();
  expect(conn.closed).toBe(true);

  await expect(conn.query("SELECT 4 AS v").firstRow()).rejects.toThrow(CLOSE_MESSAGE);
});

test("查询中销毁连接", async () => {
  await using conn = await createConn();
  const p1 = conn.query("SELECT pg_sleep(1)").rowCount();
  const p2 = conn.query("SELECT 2 AS v").rowCount();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const p3 = conn.query("SELECT 3 AS v").rowCount();
  const p4 = conn.query("SELECT 4 AS v").rowCount();

  Promise.allSettled([p1, p2, p3, p4]); // 防止 unhandled promise rejection
  await new Promise((resolve) => setTimeout(resolve, 0)); // 让 p3 和 p4 进入写入状态
  conn.destroy();

  const message = DESTROY_MESSAGE;
  await expect(p1, "正在执行中的查询在销毁后立即抛出异常").rejects.toThrow(message);
  await expect(p2, "排队执行的查询在销毁后立即抛出异常").rejects.toThrow(message);
  await expect(p3, "排队发送的查询在销毁后立即抛出异常").rejects.toThrow(message);
  await expect(p4, "排队发送的查询在销毁后立即抛出异常").rejects.toThrow(message);
});
