import { expect } from "vitest";
import { test as connectionTest } from "@test/fixtures/db_connect.ts";
import { createPgPool, type PgPool } from "@asla/pg";

const test = connectionTest.extend<{ pool: PgPool }>({
  async pool({ connect }, use) {
    const pool = createPgPool({ create: async () => connect, maxCount: 1 });
    try {
      await use(pool);
    } finally {
      const borrowed = pool.totalCount - pool.idleCount;
      expect(borrowed, "存在未释放的原生池连接").toBe(0);
      await pool[Symbol.asyncDispose]();
    }
  },
});

test("池级 query 支持 await、延迟读取与并行排队", async ({ pool }) => {
  const delayed = pool.query<{ value: number }>("SELECT 42 AS value");
  const counts = await Promise.all(Array.from({ length: 8 }, () => pool.query("SELECT 1").getRowCount()));
  expect(counts).toEqual(Array(8).fill(1));
  expect(await delayed.getFirstRow()).toEqual({ value: 42 });
  await pool.query("SELECT 2");
  expect(pool.idleCount).toBe(1);
});

test("simpleQuery 提前退出和 SQL 异常都归还", async ({ pool }) => {
  for await (const result of pool.simpleQuery("SELECT 1 AS value; SELECT 2")) {
    expect(result.rows).toEqual([{ value: 1 }]);
    break;
  }
  expect(pool.idleCount).toBe(1);
  await expect(pool.query("SELECT * FROM missing_native_pool_table").getRows()).rejects.toThrow();
  expect(await pool.query("SELECT 1").getRowCount()).toBe(1);
});

test("queryStream 读写、输入流 simpleQuery 及提前取消", async ({ pool }) => {
  const stream = pool.queryStream();
  const output = Array.fromAsync(stream.readable);
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode("SELECT 1 AS value; SELECT 2 AS value"));
  await writer.close();
  expect((await output).map((result) => result.rows)).toEqual([[{ value: 1 }], [{ value: 2 }]]);
  expect(pool.idleCount).toBe(1);
  const input = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("SELECT 3 AS value"));
      controller.close();
    },
  });
  expect((await Array.fromAsync(pool.simpleQuery(input)))[0].rows).toEqual([{ value: 3 }]);
  const cancelled = pool.queryStream();
  await cancelled.readable.cancel();
  await expect(cancelled.writable.getWriter().write(new Uint8Array())).rejects.toBeUndefined();
});

test("游标批读完成、提前退出和显式关闭归还", async ({ pool }) => {
  const cursor = pool.openCursor("SELECT generate_series(1, 3) AS value", { iteratorMaxRows: 1 });
  expect(await cursor.read(1)).toEqual([{ value: 1 }]);
  expect(pool.idleCount).toBe(0);
  await cursor.close();
  await cursor.close();
  expect(pool.idleCount).toBe(1);
  const complete = pool.openCursor("SELECT 1 AS value");
  expect(await Array.fromAsync(complete)).toEqual([{ value: 1 }]);
  expect((await complete.completion).status).toBe("complete");
  const early = pool.openCursor("SELECT generate_series(1, 4)", { iteratorMaxRows: 1 });
  for await (const _row of early) break;
  expect(early.isClosed).toBe(true);
  expect(pool.idleCount).toBe(1);
});

test("事务惰性借用、保存点、提交和 await using 回滚", async ({ pool }) => {
  const tx = pool.begin("SERIALIZABLE");
  expect(pool.totalCount).toBe(0);
  await tx.query("CREATE TEMP TABLE native_pool_tx(value int)");
  await tx.savePoint('quoted"point');
  await tx.query("INSERT INTO native_pool_tx VALUES (1)");
  await tx.rollbackTo('quoted"point');
  await tx.commit();
  expect(tx.released).toBe(true);
  expect(pool.idleCount).toBe(1);
  {
    await using rollback = pool.begin();
    await rollback.query("INSERT INTO native_pool_tx VALUES (2)");
  }
  expect(await pool.query("SELECT * FROM native_pool_tx").getRows()).toEqual([]);
});

test("事务结束自动关闭未读完的游标", async ({ pool }) => {
  const tx = pool.begin();
  const cursor = tx.openCursor("SELECT generate_series(1, 3)");
  await cursor.read(1);
  await tx.rollback();
  expect(cursor.isClosed).toBe(true);
  expect(pool.idleCount).toBe(1);
});

test("借出 wrapper 的事务持有连接直到事务结束", async ({ pool }) => {
  const connection = await pool.connect();
  const tx = connection.begin();
  await tx.query("SELECT 1");
  connection.release();
  expect(pool.idleCount).toBe(0);
  await tx.rollback();
  expect(pool.idleCount).toBe(1);
});

test("COPY IN 完成与 COPY OUT 完整读取归还", async ({ pool }) => {
  await pool.query("CREATE TEMP TABLE native_pool_copy(value int)");
  const copy = pool.copyFrom("COPY native_pool_copy FROM STDIN");
  await copy.write(new TextEncoder().encode("1\n2\n"));
  expect(pool.idleCount).toBe(0);
  await copy.writable.getWriter().close();
  expect(await copy.complete).toEqual({ rows: 2 });
  expect(pool.idleCount).toBe(1);
  const chunks = await Array.fromAsync(pool.copyTo("COPY native_pool_copy TO STDOUT"));
  expect(chunks.map((chunk) => new TextDecoder().decode(chunk)).join("")).toBe("1\n2\n");
  expect(pool.idleCount).toBe(1);
});

test("COPY IN abort 淘汰连接，关闭池等待物理关闭", async ({ pool, connect }) => {
  await pool.query("CREATE TEMP TABLE native_pool_copy_abort(value int)");
  const copy = pool.copyFrom("COPY native_pool_copy_abort FROM STDIN");
  const failure = expect(copy.complete).rejects.toThrow();
  await copy.abort("stop");
  await failure;
  expect(pool.totalCount).toBe(0);
  await pool[Symbol.asyncDispose]();
  expect(connect.closed).toBe(true);
});

test("COPY OUT cancel 淘汰连接且不悬挂池关闭", async ({ pool, connect }) => {
  const reader = pool.copyTo("COPY (SELECT generate_series(1, 100)) TO STDOUT").getReader();
  await reader.read();
  await reader.cancel();
  expect(pool.totalCount).toBe(0);
  await pool[Symbol.asyncDispose]();
  expect(connect.closed).toBe(true);
});

test("借出 wrapper 释放后，已经打开的 queryStream 仍可完成", async ({ pool }) => {
  const connection = await pool.connect();
  const stream = connection.queryStream();
  connection.release();
  expect(pool.idleCount).toBe(0);
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode("SELECT 9 AS value"));
  await writer.close();
  expect((await Array.fromAsync(stream.readable))[0].rows).toEqual([{ value: 9 }]);
  expect(pool.idleCount).toBe(1);
});

test("queryStream 执行过程中取消等到协议消费结束才归还", async ({ pool }) => {
  const stream = pool.queryStream();
  const writer = stream.writable.getWriter();
  await writer.write(new TextEncoder().encode("SELECT pg_sleep(0.02); SELECT 2"));
  const closing = expect(writer.close()).rejects.toBe("stop");
  await stream.readable.cancel("stop");
  await closing;
  expect(pool.idleCount).toBe(1);
  expect(await pool.query("SELECT 1").getRowCount()).toBe(1);
});

test("断连查询会移除物理连接", async ({ pool }) => {
  await expect(pool.query("SELECT pg_terminate_backend(pg_backend_pid())").getRows()).rejects.toThrow();
  expect(pool.totalCount).toBe(0);
});
