import { expect, test, vi } from "vitest";
import { createHarness } from "./utils/pg_pool_mock.ts";
import { PgPool } from "@/class/PgPool.ts";
import { poolForTest } from "@/class/PgPoolForTest.ts";
async function expectPending(promise: Promise<unknown>) {
  const settled = vi.fn();
  void promise.then(settled, settled);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(settled).not.toHaveBeenCalled();
}

test("pipeline 查询仅在 idle 后进入 free，借用连接不与其共享", async () => {
  const { pool, sessions } = createHarness({ maxCount: 1, maxPipeline: 2 });
  await pool.prepareConnection(1);
  const first = pool.query("SELECT 1").rows();
  const second = pool.query("SELECT 2").rows();
  const borrowing = pool.borrow();
  expect(pool.queueLength).toBe(1);

  expect(sessions[0].pendingQueyNumber).toBe(2);

  sessions[0].finishQuery();
  await first;
  expect(sessions[0].pendingQueyNumber).toBe(1);
  expect(pool.queueLength).toBe(1);
  expect(pool.idleCount).toBe(0);
  await expectPending(borrowing);
  sessions[0].finishQuery();
  await second;
  expect(pool.queueLength).toBe(0);
  const connection = await borrowing;
  connection.release();
  expect(pool.idleCount).toBe(1);
  await pool.close();
});

test.each([2, Infinity])("冷启动排队的 pipeline 查询遵守上限 %s", async (maxPipeline) => {
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
