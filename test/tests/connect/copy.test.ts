import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

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
