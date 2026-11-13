import { expect, test, vi } from "vitest";
import { createHarness } from "./utils/pg_pool_mock.ts";
import { PgPool } from "@/class/PgPool.ts";
import { poolForTest } from "@/class/PgPoolForTest.ts";

test("惰性建连", async () => {
  const { pool, create } = createHarness();
  expect(pool.totalCount).toBe(0);
  await expect(pool.borrow()).resolves.toBeDefined();
  expect(create).toHaveBeenCalledTimes(1);
});

test("连接池数量到上限后排队", async () => {
  const { pool, create } = createHarness({ maxCount: 2 });
  const promises = [pool.borrow(), pool.borrow()];
  expect(pool.totalCount).toBe(2);
  const waiting = pool.borrow();
  expect(pool.totalCount).toBe(2);
  const [first, second] = await Promise.all(promises);
  expect(create).toHaveBeenCalledTimes(2);
  first.release();
  using p3 = await waiting;

  expect(pool.totalCount).toBe(2);
  expect(create).toHaveBeenCalledTimes(2);
  p3.release();
  second.release();
  await pool.close();
});

test("借用连接在非空闲状态归还时，会进入 pipeline 池", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: 10 });
  const connection = await pool.borrow();
  const running = connection.query("SELECT 1").rows();
  connection.release();

  expect(pool.idleCount).toBe(0);
  expect(getPoolInternals(pool).inPipeline).toContain(sessions[0]);

  const waiting = pool.borrow();
  expect(pool.queueLength).toBe(1);

  await expectPending(waiting);
  sessions[0].finishQuery();
  await running;

  expect(pool.queueLength).toBe(0);
  expect(getPoolInternals(pool).inPipeline).not.toContain(sessions[0]);
  await waiting.then((c) => c.release());
  await pool.close();
});

test("空闲超时只回收 free 中的连接，不关闭借出的连接", async () => {
  const { pool, sessions } = createHarness({ maxCount: 2, idleTimeout: 10 });
  vi.useFakeTimers();
  const first = await pool.borrow();
  const second = await pool.borrow();
  first.release();

  await vi.advanceTimersByTimeAsync(30);
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  expect(sessions[1].close).not.toHaveBeenCalled();
  expect(pool.totalCount).toBe(1);
  expect(pool.idleCount).toBe(0);
  second.release();
  await pool.close();
});
test("借用连接释放后进入空闲队列，重复释放不改变计数", async () => {
  const { pool } = createHarness();
  const connection = await pool.borrow();
  expect(pool.connectedCount).toBe(1);
  expect(pool.idleCount).toBe(0);

  connection.release();
  expect(pool.idleCount).toBe(1);
  connection.release();
  expect(pool.idleCount).toBe(1);

  await pool.close();
});

test("连接工厂失败后计数归零，新请求仍可重新建连", async () => {
  const { pool, sessions, create } = createHarness();
  create.mockRejectedValueOnce(new Error("Connection failed"));
  await expect(pool.borrow()).rejects.toThrow("Connection failed");
  expect(pool.totalCount).toBe(0);
  expect(pool.closed).toBe(false);

  const connection = await pool.borrow();
  expect(create).toHaveBeenCalledTimes(2);
  expect(sessions).toHaveLength(1);
  connection.release();
  await pool.close();
});

function getPoolInternals(pool: PgPool) {
  return poolForTest.getPooInternalPool(pool);
}
async function expectPending(promise: Promise<unknown>) {
  const settled = vi.fn();
  void promise.then(settled, settled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).not.toHaveBeenCalled();
}
