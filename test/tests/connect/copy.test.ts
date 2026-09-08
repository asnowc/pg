import { expect, vi } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import type { PgConnectionImpl } from "@/connect/PgConnectionImpl.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

test("copyFrom 写入数据并等待完成", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE copy_source(id int, name text)").getCompletion();
  const copy = connect.copyFrom("COPY copy_source FROM STDIN WITH (FORMAT csv)");
  await copy.write(encoder.encode("1,first\n"));
  await copy.writable.getWriter().close();
  await expect(copy.complete).resolves.toEqual({ rows: 1 });
  await expect(connect.query("SELECT * FROM copy_source").getRows()).resolves.toEqual([{ id: 1, name: "first" }]);
});

test("COPY OUT 可读取并支持取消", async ({ connect }) => {
  const stream = connect.copyTo("COPY (SELECT generate_series(1, 3)) TO STDOUT");
  const reader = stream.getReader();
  const first = await reader.read();
  expect(first.done).toBe(false);
  expect(decoder.decode(first.value)).toContain("1");
  await reader.cancel("test cancellation");
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});

test("COPY IN 初始化 SQL 失败后排空响应，后续查询不串结果", async ({ connect }) => {
  const copy = connect.copyFrom("COPY missing_copy_table FROM STDIN");
  const next = connect.query<{ n: number }>("SELECT 42::int AS n");
  await expect(copy.write(encoder.encode("1\n"))).rejects.toThrow();
  await expect(copy.complete).rejects.toThrow();
  await expect(next.getRows()).resolves.toEqual([{ n: 42 }]);
});

test("COPY IN 数据错误后恢复查询队列", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE copy_invalid(id int)");
  const copy = connect.copyFrom("COPY copy_invalid FROM STDIN");
  await copy.write(encoder.encode("not-an-integer\n"));
  const next = connect.query("SELECT * FROM copy_invalid").getRows();
  await expect(copy.closeWrite()).rejects.toThrow();
  await expect(copy.complete).rejects.toThrow();
  await expect(next).resolves.toEqual([]);
});

test("COPY IN 写入后立即 closeWrite 不丢失等待初始化的数据", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE copy_race(id int)");
  const copy = connect.copyFrom("COPY copy_race FROM STDIN");
  const written = copy.write(encoder.encode("1\n"));
  await expect(copy.closeWrite()).resolves.toEqual({ rows: 1 });
  await written;
  await expect(connect.query("SELECT * FROM copy_race").getRows()).resolves.toEqual([{ id: 1 }]);
});

test("COPY IN 空错误消息仍发送 CopyFail 并恢复连接", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE copy_abort(id int)");
  const copy = connect.copyFrom("COPY copy_abort FROM STDIN");
  await copy.write(encoder.encode("1\n"));
  await copy.abort(new Error(""));
  await expect(copy.complete).rejects.toThrow();
  await expect(connect.query("SELECT * FROM copy_abort").getRows()).resolves.toEqual([]);
});

test("COPY IN 传输写失败后结算 complete 和排队查询，不等待 finish 死锁", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE copy_write_failure(id int)");
  const copy = connect.copyFrom("COPY copy_write_failure FROM STDIN");
  await copy.write(encoder.encode("1\n"));
  const error = new Error("injected COPY transport write failure");
  const spy = vi.spyOn(connect as PgConnectionImpl, "writeCopyData").mockRejectedValueOnce(error);
  try {
    const queued = connect.query("SELECT 1").getRows();
    await expect(copy.write(encoder.encode("2\n"))).rejects.toBe(error);
    await expect(copy.complete).rejects.toBe(error);
    await expect(queued).rejects.toThrow();
    await expect(copy.closeWrite()).rejects.toBe(error);
    await copy.abort();
    expect(connect.closed).toBe(true);
  } finally {
    spy.mockRestore();
  }
});
