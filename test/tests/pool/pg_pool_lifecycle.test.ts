import { afterEach, expect, test, vi } from "vitest";
import { connectSession, createHarness, MockSession, pools } from "./utils/pg_pool_mock.ts";

async function expectPending(promise: Promise<unknown>) {
  const settled = vi.fn();
  void promise.then(settled, settled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).not.toHaveBeenCalled();
}

afterEach(() => {
  try {
    for (const pool of pools) pool.destroy();
    for (const pool of pools) {
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
    }
  } finally {
    pools.clear();
    vi.useRealTimers();
  }
});

test("惰性建连，空池关闭和重复关闭不会创建连接", async () => {
  const { pool, create } = createHarness();
  expect(pool.closed).toBe(false);
  expect(pool.totalCount).toBe(0);
  pool.query("SELECT 1");
  expect(create).not.toHaveBeenCalled();

  await pool.close();
  await pool.close();
  expect(pool.closed).toBe(true);
  expect(create).not.toHaveBeenCalled();
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");
  await expect(pool.query("SELECT 1").rows()).rejects.toThrow("Pool is closed");
});

test("借用连接释放后进入空闲队列，重复释放不改变计数", async () => {
  const { pool, sessions, create } = createHarness();
  const connection = await pool.borrow();
  expect(pool.connectedCount).toBe(1);
  expect(pool.idleCount).toBe(0);

  connection.release();
  connection.release();
  expect(pool.idleCount).toBe(1);
  const reused = await pool.borrow();
  expect(reused.processId).toBe(connection.processId);
  expect(create).toHaveBeenCalledTimes(1);
  reused.release();

  await pool.close();
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
});

test("close 等待借用连接释放，并让重复关闭共同等待", async () => {
  const { pool, sessions } = createHarness();
  const connection = await pool.borrow();
  const closing = pool.close();
  const closingAgain = pool.close();
  expect(pool.closed).toBe(true);
  await expectPending(closing);
  await expectPending(closingAgain);
  expect(sessions[0].close).not.toHaveBeenCalled();
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");

  connection.release();
  await Promise.all([closing, closingAgain]);
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
});

test("关闭期间继续满足已排队的借用请求，最后一次归还后结束关闭", async () => {
  const { pool } = createHarness({ maxCount: 1 });
  const first = await pool.borrow();
  const waiting = pool.borrow();
  const closing = pool.close();
  first.release();
  const second = await waiting;
  await expectPending(closing);
  expect(pool.idleCount).toBe(0);

  second.release();
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("建连过程中关闭，成功建连后仍完成已有借用再关闭", async () => {
  const { pool, create, source } = createHarness();
  const creating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  expect(pool.totalCount).toBe(1);
  expect(pool.connectedCount).toBe(0);
  const closing = pool.close();
  await expectPending(closing);

  creating.resolve(source);
  const connection = await borrowing;
  await expectPending(closing);
  connection.release();
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("关闭期间建连失败会拒绝借用请求并完成关闭", async () => {
  const { pool, create, source } = createHarness();
  const creating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Connection failed");
  const closing = pool.close();
  creating.reject(new Error("Connection failed"));

  await failed;
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("一条连接创建失败不会提前结束对其他借用连接的关闭等待", async () => {
  const { pool, create, source } = createHarness({ maxCount: 2 });
  const connection = await pool.borrow();
  const creating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Connection failed");
  const closing = pool.close();
  creating.reject(new Error("Connection failed"));
  await failed;
  await expectPending(closing);

  connection.release();
  await closing;
});

test("借用连接带在途查询归还时，必须等 idle 才能再次借用", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const connection = await pool.borrow();
  const running = connection.query("SELECT 1").rows();
  connection.release();
  expect(pool.idleCount).toBe(0);
  const waiting = pool.borrow();
  const received = vi.fn();
  void waiting.then(received);
  await Promise.resolve();
  expect(received).not.toHaveBeenCalled();

  sessions[0].finishQuery();
  await running;
  const next = await waiting;
  expect(pool.idleCount).toBe(0);
  next.release();
  expect(pool.idleCount).toBe(1);
  await pool.close();
});

test("pipeline 查询仅在 idle 后进入 free，借用连接不与其共享", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: 2 });
  const first = pool.query("SELECT 1").rows();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(1));
  const second = pool.query("SELECT 2").rows();
  const borrowing = pool.borrow();
  const received = vi.fn();
  void borrowing.then(received);
  expect(sessions[0].pendingQueyNumber).toBe(2);

  sessions[0].finishQuery();
  await first;
  expect(pool.idleCount).toBe(0);
  expect(received).not.toHaveBeenCalled();
  sessions[0].finishQuery();
  await second;
  const connection = await borrowing;
  connection.release();
  expect(pool.idleCount).toBe(1);
  await pool.close();
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

test("空闲连接关闭失败时销毁该连接，重复关闭仍可完成", async () => {
  const { pool, sessions } = createHarness();
  const connection = await pool.borrow();
  connection.release();
  sessions[0].close.mockRejectedValueOnce(new Error("Close failed"));

  await pool.close();
  await pool.close();
  expect(sessions[0].destroy).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
});

test("destroy 拒绝等待请求和在途查询，并可重复调用", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const connection = await pool.borrow();
  const running = connection.query("SELECT 1").rows();
  const failedQuery = expect(running).rejects.toThrow("Pool is destroyed");
  const waiting = pool.borrow();
  const failedBorrow = expect(waiting).rejects.toThrow("Pool is destroyed");
  const closing = pool.close();

  pool.destroy();
  pool.destroy();
  await Promise.all([failedQuery, failedBorrow, closing]);
  await pool.close();
  expect(sessions[0].destroy).toHaveBeenCalledTimes(1);
  await expect(pool.borrow()).rejects.toThrow("Pool is closed");
});

test("destroy 后才完成的建连会被关闭，不会重新加入池", async () => {
  const { pool, create, source, sessions } = createHarness();
  const creating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(creating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Pool is destroyed");
  pool.destroy();
  await failed;

  creating.resolve(source);
  await vi.waitFor(() => expect(sessions[0]?.close).toHaveBeenCalledTimes(1));
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);
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

test.each([1, 2, Infinity])("冷启动排队的 pipeline 查询遵守上限 %s", async (maxPipeline) => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline });
  const queries = Array.from({ length: 5 }, () => pool.query("SELECT 1").rows());
  await vi.waitFor(() => expect(sessions).toHaveLength(1));
  const session = sessions[0];
  const limit = Math.min(maxPipeline, queries.length);
  expect(session.pendingQueyNumber).toBe(limit);

  for (let completed = 0; completed < queries.length; completed++) {
    expect(session.pendingQueyNumber).toBeGreaterThan(0);
    expect(session.pendingQueyNumber).toBeLessThanOrEqual(limit);
    session.finishQuery();
  }
  await Promise.all(queries);
  expect(pool.idleCount).toBe(1);
  await pool.close();
});

test("混合等待队列按查询、借用、查询顺序交接连接", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: Infinity });
  const first = pool.query("SELECT 1").rows();
  const borrowing = pool.borrow();
  const last = pool.query("SELECT 2").rows();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(1));
  const session = sessions[0];
  expect(session.queryWriter.extendedQuery).toHaveBeenCalledTimes(1);
  await expectPending(borrowing);

  session.finishQuery();
  await first;
  const connection = await borrowing;
  expect(session.queryWriter.extendedQuery).toHaveBeenCalledTimes(1);
  await expectPending(last);
  connection.release();
  expect(session.pendingQueyNumber).toBe(1);
  session.finishQuery();
  await last;
  expect(pool.idleCount).toBe(1);
  await pool.close();
});

test("连接仍被借用时的 idle 不会使其进入 free", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const connection = await pool.borrow();
  const running = connection.query("SELECT 1").rows();
  const waiting = pool.borrow();
  sessions[0].finishQuery();
  await running;
  await expectPending(waiting);
  expect(pool.idleCount).toBe(0);

  connection.release();
  const next = await waiting;
  next.release();
  await pool.close();
});

test("pipeline 查询失败后等待 idle，后续请求仍可取得连接", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const first = pool.query("SELECT 1").rows();
  const failed = expect(first).rejects.toThrow("Query failed");
  const second = pool.query("SELECT 2").rows();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(1));
  sessions[0].finishQuery(new Error("Query failed"));
  await failed;
  expect(sessions[0].pendingQueyNumber).toBe(1);
  sessions[0].finishQuery();
  await second;
  expect(pool.idleCount).toBe(1);
  await pool.close();
});

test("关闭期间排队查询全部完成后才结束关闭", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: 2 });
  const queries = Array.from({ length: 4 }, () => pool.query("SELECT 1").rows());
  const closing = pool.close();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(2));
  await expectPending(closing);

  for (let completed = 0; completed < queries.length; completed++) {
    sessions[0].finishQuery();
  }
  await Promise.all([...queries, closing]);
  expect(pool.totalCount).toBe(0);
});

test("pipeline 的写端关闭完成后仍等待所有在途查询和 close 事件", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: 2 });
  const first = pool.query("SELECT 1").rows();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(1));
  const second = pool.query("SELECT 2").rows();
  const closing = pool.close();
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  await expectPending(closing);

  sessions[0].finishQuery();
  await first;
  await expectPending(closing);
  sessions[0].finishQuery();
  await Promise.all([second, closing]);
  expect(pool.totalCount).toBe(0);
});

test("多条连接乱序完成建连，关闭必须等待全部借用归还", async () => {
  const { pool, create, source } = createHarness({ maxCount: 2 });
  const firstCreating = Promise.withResolvers<typeof source>();
  const secondCreating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(firstCreating.promise).mockReturnValueOnce(secondCreating.promise);
  const firstBorrowing = pool.borrow();
  const secondBorrowing = pool.borrow();
  expect(pool.totalCount).toBe(2);
  const closing = pool.close();

  secondCreating.resolve(source);
  const first = await firstBorrowing;
  await expectPending(closing);
  firstCreating.resolve(source);
  const second = await secondBorrowing;
  expect(second.processId).not.toBe(first.processId);
  first.release();
  expect(pool.totalCount).toBe(1);
  await expectPending(closing);
  second.release();
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("所有并行建连失败时，最后一个失败任务结束后关闭才完成", async () => {
  const { pool, create, source } = createHarness({ maxCount: 2 });
  const firstCreating = Promise.withResolvers<typeof source>();
  const secondCreating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(firstCreating.promise).mockReturnValueOnce(secondCreating.promise);
  const firstBorrowing = pool.borrow();
  const secondBorrowing = pool.borrow();
  const failed = Promise.all([
    expect(firstBorrowing).rejects.toThrow("First failed"),
    expect(secondBorrowing).rejects.toThrow("First failed"),
  ]);
  const closing = pool.close();

  firstCreating.reject(new Error("First failed"));
  await failed;
  await expectPending(closing);
  expect(pool.totalCount).toBe(1);
  secondCreating.reject(new Error("Second failed"));
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("认证失败后计数归零，新请求仍可重新建连", async () => {
  const { pool, sessions, create } = createHarness();
  connectSession.mockRejectedValueOnce(new Error("Authentication failed"));
  await expect(pool.borrow()).rejects.toThrow("Authentication failed");
  expect(pool.totalCount).toBe(0);
  expect(pool.closed).toBe(false);

  const connection = await pool.borrow();
  expect(create).toHaveBeenCalledTimes(2);
  expect(sessions).toHaveLength(1);
  connection.release();
  await pool.close();
});

test("关闭期间认证失败会拒绝等待请求并完成关闭", async () => {
  const { pool } = createHarness();
  const authenticating = Promise.withResolvers<MockSession>();
  connectSession.mockReturnValueOnce(authenticating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Authentication failed");
  await vi.waitFor(() => expect(connectSession).toHaveBeenCalledTimes(1));
  const closing = pool.close();
  authenticating.reject(new Error("Authentication failed"));
  await Promise.all([failed, closing]);
  expect(pool.totalCount).toBe(0);
});

test("空闲连接意外断开后从集合移除，后续请求重新建连", async () => {
  const { pool, sessions, create } = createHarness();
  const first = await pool.borrow();
  first.release();
  sessions[0].destroy(new Error("Disconnected"));
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);

  const second = await pool.borrow();
  expect(second.processId).not.toBe(first.processId);
  expect(create).toHaveBeenCalledTimes(2);
  second.release();
  await pool.close();
});

test("关闭期间借出的连接断开可完成关闭，重复 close 事件不改变计数", async () => {
  const { pool, sessions } = createHarness();
  await pool.borrow();
  const closing = pool.close();
  sessions[0].destroy(new Error("Disconnected"));
  sessions[0].emit("close", undefined);
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("关闭多条空闲连接时，必须等待每条连接的 close 事件", async () => {
  const { pool, sessions } = createHarness({ maxCount: 2 });
  const first = await pool.borrow();
  const second = await pool.borrow();
  first.release();
  second.release();
  for (const session of sessions) session.close.mockImplementation(async () => {});
  const closing = pool.close();
  sessions[1].emit("close", undefined);
  await expectPending(closing);
  expect(pool.totalCount).toBe(1);
  sessions[0].emit("close", undefined);
  await closing;
  expect(pool.totalCount).toBe(0);
});

test("异步释放池与 close 一样等待借用连接归还", async () => {
  const { pool } = createHarness();
  const connection = await pool.borrow();
  const disposing = pool[Symbol.asyncDispose]();
  await expectPending(disposing);
  connection.release();
  await disposing;
  expect(pool.closed).toBe(true);
});

test("建连前 destroy 不创建连接，并拒绝已有未消费 reader", async () => {
  const { pool, create } = createHarness();
  const reader = pool.query("SELECT 1");
  pool.destroy();
  pool.destroy();
  await pool.close();
  await expect(reader.rows()).rejects.toThrow("Pool is closed");
  expect(create).not.toHaveBeenCalled();
  expect(pool.closed).toBe(true);
});

test.each(["create", "authenticate"] as const)("destroy 后 %s 阶段失败不会重新建连", async (stage) => {
  const { pool, create, source } = createHarness();
  const creating = Promise.withResolvers<typeof source>();
  const authenticating = Promise.withResolvers<MockSession>();
  if (stage === "create") create.mockReturnValueOnce(creating.promise);
  else connectSession.mockReturnValueOnce(authenticating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Pool is destroyed");
  if (stage === "authenticate") {
    await vi.waitFor(() => expect(connectSession).toHaveBeenCalledTimes(1));
  }
  pool.destroy();
  await failed;

  if (stage === "create") creating.reject(new Error("Late failure"));
  else authenticating.reject(new Error("Late failure"));
  await vi.waitFor(() => expect(pool.totalCount).toBe(0));
  await pool.close();
  expect(create).toHaveBeenCalledTimes(1);
});

test("destroy 后才完成的认证 session 会关闭而不会入池", async () => {
  const { pool, sessions } = createHarness();
  const authenticating = Promise.withResolvers<MockSession>();
  connectSession.mockReturnValueOnce(authenticating.promise);
  const borrowing = pool.borrow();
  const failed = expect(borrowing).rejects.toThrow("Pool is destroyed");
  await vi.waitFor(() => expect(connectSession).toHaveBeenCalledTimes(1));
  pool.destroy();
  await failed;

  const session = new MockSession(99);
  authenticating.resolve(session);
  await vi.waitFor(() => expect(session.close).toHaveBeenCalledTimes(1));
  expect(sessions).toHaveLength(0);
  expect(pool.totalCount).toBe(0);
});

test("空闲超时从最近一次归还开始计时，全部回收后停止定时器", async () => {
  const { pool, sessions } = createHarness({ idleTimeout: 10 });
  vi.useFakeTimers();
  const first = await pool.borrow();
  first.release();
  await vi.advanceTimersByTimeAsync(9);
  const second = await pool.borrow();
  await vi.advanceTimersByTimeAsync(11);
  expect(sessions[0].close).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  second.release();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(20);
  expect(sessions[0].close).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
  expect(vi.getTimerCount()).toBe(0);

  const third = await pool.borrow();
  third.release();
  expect(vi.getTimerCount()).toBe(1);
  await pool.close();
  expect(vi.getTimerCount()).toBe(0);
});

test.each(["close", "destroy"] as const)("%s 清理空闲回收定时器", async (method) => {
  const { pool, sessions } = createHarness({ idleTimeout: 10 });
  vi.useFakeTimers();
  const connection = await pool.borrow();
  connection.release();
  expect(vi.getTimerCount()).toBe(1);
  await pool[method]();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(100);
  expect(sessions[0].close).toHaveBeenCalledTimes(method === "close" ? 1 : 0);
  expect(sessions[0].destroy).toHaveBeenCalledTimes(method === "destroy" ? 1 : 0);
});

test("结果完成不等于连接 idle，借用必须等待 ReadyForQuery", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const running = pool.query("SELECT 1").rows();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(1));
  const borrowing = pool.borrow();
  sessions[0].completeQuery();
  await running;
  expect(sessions[0].pendingQueyNumber).toBe(1);
  expect(pool.idleCount).toBe(0);
  await expectPending(borrowing);

  sessions[0].readyQuery();
  const connection = await borrowing;
  connection.release();
  await pool.close();
});

test("查询失败与 idle 分离时，不会将尚未恢复的连接交给借用者", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1 });
  const running = pool.query("SELECT 1").rows();
  const failed = expect(running).rejects.toThrow("Query failed");
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(1));
  const borrowing = pool.borrow();
  sessions[0].completeQuery(new Error("Query failed"));
  await failed;
  await expectPending(borrowing);
  expect(pool.idleCount).toBe(0);

  sessions[0].readyQuery();
  const connection = await borrowing;
  connection.release();
  await pool.close();
});

test("连接数上限包括建连任务，多余借用请求按队列顺序复用连接", async () => {
  const { pool, create, source } = createHarness({ maxCount: 1 });
  const creating = Promise.withResolvers<typeof source>();
  create.mockReturnValueOnce(creating.promise);
  const borrowings = Array.from({ length: 5 }, () => pool.borrow());
  expect(create).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(1);
  expect(pool.connectedCount).toBe(0);
  creating.resolve(source);
  const order: number[] = [];
  const releasing = borrowings.map(async (borrowing, index) => {
    const connection = await borrowing;
    order.push(index);
    expect(pool.totalCount).toBe(1);
    expect(pool.idleCount).toBe(0);
    connection.release();
  });
  await Promise.all(releasing);
  expect(order).toEqual([0, 1, 2, 3, 4]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(pool.idleCount).toBe(1);
  await pool.close();
});

test("单次查询的 pipeline 上限在排队和直接复用两条路径都生效", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: 1 });
  const first = pool.query("SELECT 1", { maxPipeline: 3 }).rows();
  const second = pool.query("SELECT 2", { maxPipeline: 3 }).rows();
  await vi.waitFor(() => expect(sessions[0]?.pendingQueyNumber).toBe(2));
  const third = pool.query("SELECT 3", { maxPipeline: 3 }).rows();
  const fourth = pool.query("SELECT 4", { maxPipeline: 3 }).rows();
  expect(sessions[0].pendingQueyNumber).toBe(3);
  expect(sessions[0].queryWriter.extendedQuery).toHaveBeenCalledTimes(3);

  sessions[0].finishQuery();
  await first;
  expect(sessions[0].pendingQueyNumber).toBe(2);
  sessions[0].finishQuery();
  sessions[0].finishQuery();
  expect(sessions[0].queryWriter.extendedQuery).toHaveBeenCalledTimes(4);
  sessions[0].finishQuery();
  await Promise.all([second, third, fourth]);
  await pool.close();
});

test.each(["同步抛错", "非 Error 拒绝"] as const)("连接工厂%s会拒绝请求且不泄漏建连计数", async (failure) => {
  const { pool, create } = createHarness();
  if (failure === "同步抛错") {
    create.mockImplementationOnce(() => {
      throw new Error("Create failed");
    });
  } else {
    create.mockRejectedValueOnce("Create failed");
  }
  const rejected = vi.fn();
  void pool.borrow().then((connection) => connection.release(), rejected);
  await vi.waitFor(() => {
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ message: "Create failed" }));
  }, { timeout: 200, interval: 10 });
  expect(pool.totalCount).toBe(0);
  expect(pool.idleCount).toBe(0);
  expect(pool.closed).toBe(false);
  await pool.close();
});

test("默认禁用空闲回收，不创建定时器", async () => {
  const { pool, sessions } = createHarness();
  vi.useFakeTimers();
  const connection = await pool.borrow();
  connection.release();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sessions[0].close).not.toHaveBeenCalled();
  expect(pool.idleCount).toBe(1);
  await pool.close();
});
