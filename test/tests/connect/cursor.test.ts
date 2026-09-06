import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("游标分页读取并报告完成", async ({ connect }) => {
  await using cursor = connect.openCursor<{ value: number }>(
    "SELECT generate_series(1, 5)::int AS value",
    { iteratorMaxRows: 2 },
  );
  await expect(cursor.read(2)).resolves.toEqual([{ value: 1 }, { value: 2 }]);
  await expect(cursor.read(2)).resolves.toEqual([{ value: 3 }, { value: 4 }]);
  await expect(cursor.read(2)).resolves.toEqual([{ value: 5 }]);
  expect(cursor.rowsRead).toBe(5);
  await expect(cursor.getCompletion()).resolves.toMatchObject({ status: "complete" });
});

test("游标禁止并行 read 且可重复关闭", async ({ connect }) => {
  const cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
  const firstRead = cursor.read(1);
  await expect(cursor.read(1)).rejects.toThrow();
  await expect(firstRead).resolves.toEqual([{ value: 1 }]);
  await cursor.close();
  await cursor.close();
  expect(cursor.isClosed).toBe(true);
});

test("提前结束异步迭代会关闭 portal", async ({ connect }) => {
  const cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 10)::int AS value");
  for await (const _row of cursor) break;
  expect(cursor.isClosed).toBe(true);
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});
