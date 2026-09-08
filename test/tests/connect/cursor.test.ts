import { describe, expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import type { FieldInfo, QueryCompletion } from "@asla/pg";

describe("read()", function () {
  test("游标分页读取并报告完成", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    await expect(cursor.read(2)).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    expect(cursor.rowsRead).toBe(2);
    await expect(cursor.read(2)).resolves.toEqual([{ value: 3 }, { value: 4 }]);
    expect(cursor.rowsRead).toBe(4);
    await expect(cursor.read(2)).resolves.toEqual([{ value: 5 }]);
    expect(cursor.rowsRead).toBe(5);
    await expect(cursor.read(2)).resolves.toEqual([]);
    expect(cursor.isClosed).toBe(true);
  });
  test("read() 可进入队列", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");

    const [r1, r2, r3] = await Promise.all([
      cursor.read(2),
      cursor.read(2),
      cursor.read(2),
    ]);
    await expect(r1).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    await expect(r2).resolves.toEqual([{ value: 3 }, { value: 4 }]);
    await expect(r3).resolves.toEqual([{ value: 5 }]);

    expect(cursor.rowsRead).toBe(5);
  });
});
describe("info", function () {
  test("complete getCompletion()", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    await Array.fromAsync(cursor);
    await expect(cursor.completion).resolves.toMatchObject(
      { status: "complete", rowCount: 5, notices: [] } satisfies Partial<QueryCompletion>,
    );
  });
  test("closed getCompletion()", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    await cursor.read(2);
    await cursor.close();
    await expect(cursor.completion).resolves.toMatchObject(
      { status: "closed", rowCount: 5, notices: [] } satisfies Partial<QueryCompletion>,
    );
  });
  test("get fields", async function ({ connect }) {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    const fields = await cursor.fields;
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject(
      { index: 0, name: "value" } satisfies Partial<FieldInfo>,
    );
  });
});
describe("异步迭代器", () => {
  test("通过异步迭代器读取全部", async function ({ connect }) {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value", {
      iteratorMaxRows: 2,
    });
    const results = await Array.fromAsync(cursor);
    expect(cursor.isClosed).toBe(true);
    await expect(results.map((r) => r.value)).resolves.toEqual([1, 2, 3, 4, 5]);
  });

  test("提前结束异步迭代会关闭 portal", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 10)::int AS value", {
      iteratorMaxRows: 2,
    });
    for await (const _row of cursor) {
      expect(cursor.rowsRead).toBe(1);
      expect(_row).toEqual({ value: 1 });
      break;
    }
    expect(cursor.isClosed).toBe(true);
    //TODO: 断言只执行了一次 Execute 或者只读取了一行数据
  });
  test("返回空数据", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 0)::int AS value");
    const results = await Array.fromAsync(cursor);
    expect(cursor.isClosed).toBe(true);
    await expect(results).resolves.toEqual([]);
  });
  test("迭代器只有第一次能调用会有数据", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    const [r1, r2] = await Promise.all([
      Array.fromAsync(cursor),
      Array.fromAsync(cursor),
    ]);
    expect(cursor.isClosed).toBe(true);
    expect(r1.length).toBe(5);
    expect(r2).toEqual([]);
  });
  test("迭代器调用后，再调用 read() 应返回空数组", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value", {
      iteratorMaxRows: 2,
    });
    const iterator = cursor[Symbol.asyncIterator]();
    const r1 = cursor.read(1);
    const r = await iterator.next();
    expect(r.done).toBe(false);
    expect(r.value).toHaveLength(2);
    await expect(r1).resolves.toHaveLength(0);

    await cursor.close();
  });
  test("调用 read 后，再调用迭代器会读取剩余数据", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value", {
      iteratorMaxRows: 2,
    });
    await expect(cursor.read(2)).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    const results = await Array.fromAsync(cursor);
    expect(cursor.isClosed).toBe(true);
    await expect(results.map((r) => r.value)).resolves.toEqual([3, 4, 5]);
  });
});
describe("关闭游标", () => {
  test("close() 可重复关闭", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    const firstRead = cursor.read(1);
    await expect(cursor.read(1)).rejects.toThrow();
    await expect(firstRead).resolves.toEqual([{ value: 1 }]);
    await cursor.close();
    await cursor.close();
    expect(cursor.isClosed).toBe(true);
  });
  test("close() 可重复关闭（多次调用）", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    await cursor.read(5);
    await cursor.read(5);
    await Promise.all([cursor.close(), cursor.close()]);
    expect(cursor.isClosed).toBe(true);
    await cursor.close();
    expect(cursor.isClosed).toBe(true);
  });
});
