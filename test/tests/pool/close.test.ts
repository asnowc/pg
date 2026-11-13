import { expect, test, vi } from "vitest";
import type { PgConnection } from "@asla/pg";
import { createHarness, createMockConnection } from "./utils/pg_pool_mock.ts";

async function expectPending(promise: Promise<unknown>) {
  const settled = vi.fn();
  void promise.then(settled, settled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).not.toHaveBeenCalled();
}

test("连接池关闭后再执行查询或借用会抛出异常", async () => {
  const { pool, create } = createHarness();
  const creating = Promise.withResolvers<PgConnection>();
  create.mockImplementation(() => creating.promise);
  const borrowing = pool.borrow();
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  const closePromise = pool.close();
  await expect(pool.query("SELECT 1").rows()).rejects.toThrow("Pool is closed");
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");
  creating.resolve(createMockConnection(1).conn);
  const connection = await borrowing;
  connection.release();
  await closePromise;
  await expect(pool.query("SELECT 1").rows()).rejects.toThrow("Pool is closed");
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");
});

test("空池关闭和重复关闭不会创建连接", async () => {
  const { pool, create } = createHarness();
  expect(pool.closed).toBe(false);
  expect(pool.totalCount).toBe(0);

  await pool.close();
  await pool.close();
  expect(pool.closed).toBe(true);
  expect(create).not.toHaveBeenCalled();
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");
  await expect(pool.query("SELECT 1").rows()).rejects.toThrow("Pool is closed");
});

test("close 等待借用连接释放，并让重复关闭共同等待", async () => {
  const { pool, sessions } = createHarness();
  const connection = await pool.borrow();
  const closing = pool.close();
  const closingAgain = pool.close();
  expect(pool.closed).toBe(true);
  expect(sessions[0].close).not.toHaveBeenCalled();

  connection.release();
  await Promise.all([closing, closingAgain]);
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
});

test("关闭期间继续满足已排队的借用请求，最后一次归还后结束关闭", async () => {
  const { pool } = createHarness({ maxCount: 1 });
  const first = await pool.borrow();
  const waiting = pool.borrow();
  expect(pool.queueLength).toBe(1);
  const closing = pool.close();
  first.release();
  const second = await waiting;
  expect(pool.queueLength).toBe(0);
  await expectPending(closing);
  expect(pool.idleCount).toBe(0);

  second.release();
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("建连过程中关闭，成功建连后仍完成已有借用再关闭", async () => {
  const { pool, create } = createHarness();
  const creating = Promise.withResolvers<PgConnection>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  expect(pool.totalCount).toBe(1);
  expect(pool.connectedCount).toBe(0);
  const closing = pool.close();

  const { conn, session } = createMockConnection(97);
  creating.resolve(conn);
  const connection = await borrowing;
  await expectPending(closing);
  connection.release();
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("关闭期间建连失败会拒绝借用请求并完成关闭", async () => {
  const { pool, create } = createHarness();
  const creating = Promise.withResolvers<PgConnection>();
  create.mockReturnValueOnce(creating.promise);
  const failed = expect(pool.borrow()).rejects.toThrow("Connection failed");
  const closing = pool.close();
  creating.reject(new Error("Connection failed"));

  await failed;
  await closing;
  expect(create).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
});

test("一条连接创建失败后，关闭会复用已借出的连接执行排队查询", async () => {
  const { pool, create } = createHarness({ maxCount: 2, maxPipeline: 1 });
  const connection = await pool.borrow(); // create 1
  const creating = Promise.withResolvers<PgConnection>();
  create.mockReturnValueOnce(creating.promise);
  const queryPromise = pool.borrow(); // create 2

  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  expect(pool.queueLength).toBe(1);
  const closing = pool.close();
  creating.reject(new Error("Connection failed"));
  expect(pool.queueLength).toBe(1);
  connection.release();
  expect(pool.queueLength).toBe(0);
  expect(create).toHaveBeenCalledTimes(2);
  await expectPending(closing);

  const query = await queryPromise;
  query.release();
  await closing;
});

test("close 在 session 真正触发 close 前不会完成", async () => {
  const { pool, sessions } = createHarness();
  const connection = await pool.borrow();
  connection.release();
  sessions[0].close.mockImplementation(async () => {});
  const closing = pool.close();
  await expectPending(closing);

  sessions[0].emit("close", undefined);
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("空闲连接关闭失败时销毁该连接", async () => {
  const { pool, sessions } = createHarness();
  await pool.prepareConnection(1);
  sessions[0].close.mockRejectedValueOnce(new Error("Close failed"));

  await pool.close();
  expect(sessions[0].destroy).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
});

test("空闲连接意外断开后从集合移除，后续请求重新建连", async () => {
  const { pool, sessions, create } = createHarness();
  await pool.prepareConnection(1);
  sessions[0].destroy(new Error("Disconnected"));
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);

  const second = await pool.borrow();
  expect(create).toHaveBeenCalledTimes(2);
  second.release();
  await pool.close();
});

test("destroy 拒绝等待请求和在途查询，并可重复调用", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const connection = await pool.borrow();
  const failedQuery = expect(connection.query("SELECT 1").rows()).rejects.toThrow("Pool is destroyed");
  const failedBorrow = expect(pool.borrow()).rejects.toThrow("Pool is destroyed");
  const closing = pool.close();

  pool.destroy();
  pool.destroy();
  await Promise.all([failedQuery, failedBorrow, closing]);
  await pool.close();
  expect(sessions[0].destroy).toHaveBeenCalledTimes(1);
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");
});
test("destroy 后才完成的建连会被关闭，不会重新加入池", async () => {
  const { pool, create } = createHarness();
  const creating = Promise.withResolvers<PgConnection>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  pool.destroy();
  await expect(borrowing).rejects.toThrow("Pool is destroyed");

  const { conn, session } = createMockConnection(97);
  creating.resolve(conn);
  await vi.waitFor(() => expect(session.destroy).toHaveBeenCalledTimes(1));
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);
});
test("destroy 后 create promise 失败不会触发重试", async () => {
  const { pool, create } = createHarness();
  const creating = Promise.withResolvers<PgConnection>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Pool is destroyed");
  pool.destroy();
  await failed;

  creating.reject(new Error("Late failure"));
  await vi.waitFor(() => expect(pool.totalCount).toBe(0));
  await pool.close();
  expect(create).toHaveBeenCalledTimes(1);
});
