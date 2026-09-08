import { describe, expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import { createSqlBuilder, JS_DATA_ENCODER_V1 } from "@asla/pg";
import type { FieldInfo, QueryCompletion } from "@asla/pg";

const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

for (const argsFormat of [0, 1] as const) {
  test(`游标绑定手工 statement 的 NULL（格式 ${argsFormat}）`, async ({ connect }) => {
    await using cursor = connect.openCursor<{ nullable: string | null; empty: string }>({
      sqlTemplate: "SELECT $1::text AS nullable, $2::text AS empty",
      argsFormat,
      args: [null, argsFormat === 0 ? "" : new Uint8Array()],
    });
    await expect(cursor.read(2)).resolves.toEqual([{ nullable: null, empty: "" }]);
    await expect(cursor.completion).resolves.toMatchObject({ status: "complete", rowCount: 1 });
  });
}

test("游标分页读取包含 NULL 的 SQL 模板参数", async ({ connect }) => {
  const statement = sql`SELECT ${null}::text AS nullable, ${42} AS value, ${null}::int AS other,
    ${""} AS empty, generate_series(1, 3)::int AS n`;
  await using cursor = connect.openCursor(statement);
  const row = { nullable: null, value: 42, other: null, empty: "" };
  await expect(cursor.read(2)).resolves.toEqual([{ ...row, n: 1 }, { ...row, n: 2 }]);
  await expect(cursor.read(2)).resolves.toEqual([{ ...row, n: 3 }]);
  expect(cursor.rowsRead).toBe(3);
  expect(cursor.isClosed).toBe(true);
  await expect(cursor.completion).resolves.toMatchObject({ status: "complete" });
});

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
  test("read() 拒绝并发读取，完成后可继续读取", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 5)::int AS value");
    const first = cursor.read(2);
    await expect(cursor.read(2)).rejects.toThrow("already in progress");
    await expect(first).resolves.toEqual([{ value: 1 }, { value: 2 }]);
    await expect(cursor.read(2)).resolves.toEqual([{ value: 3 }, { value: 4 }]);
    await expect(cursor.read(2)).resolves.toEqual([{ value: 5 }]);

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
      { status: "closed", notices: [] } satisfies Partial<QueryCompletion>,
    );
    expect((await cursor.completion).rowCount).toBeUndefined();
    expect(cursor.rowsRead).toBe(2);
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
    expect(results.map((r) => r.value)).toEqual([1, 2, 3, 4, 5]);
  });

  test("提前结束异步迭代会关闭 portal", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 10)::int AS value", {
      iteratorMaxRows: 2,
    });
    for await (const _row of cursor) {
      expect(cursor.rowsRead).toBe(2);
      expect(_row).toEqual({ value: 1 });
      break;
    }
    expect(cursor.isClosed).toBe(true);
    await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
  });
  test("返回空数据", async ({ connect }) => {
    await using cursor = connect.openCursor<{ value: number }>("SELECT generate_series(1, 0)::int AS value");
    const results = await Array.fromAsync(cursor);
    expect(cursor.isClosed).toBe(true);
    expect(results).toEqual([]);
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
    expect(r.value).toEqual({ value: 1 });
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
    expect(results.map((r) => r.value)).toEqual([3, 4, 5]);
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
    await cursor.read(1);
    await Promise.all([cursor.close(), cursor.close()]);
    expect(cursor.isClosed).toBe(true);
    await cursor.close();
    expect(cursor.isClosed).toBe(true);
  });
});

test("游标初始化失败结算 fields、completion 和排队读取，并恢复连接", async ({ connect }) => {
  const cursor = connect.openCursor("SELECT FROM");
  await expect(cursor.read()).rejects.toThrow();
  await expect(cursor.fields).rejects.toThrow();
  await expect(cursor.completion).rejects.toThrow();
  await cursor.close();
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});

test("游标执行失败结算当前 read 并恢复连接", async ({ connect }) => {
  const cursor = connect.openCursor("SELECT 1 / 0");
  await expect(cursor.read()).rejects.toThrow();
  await expect(cursor.completion).rejects.toThrow();
  await cursor.close();
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});
