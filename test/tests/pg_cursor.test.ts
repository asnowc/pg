import { DbQuery, ParallelQueryError } from "@asla/pg";
import { beforeEach, expect } from "vitest";

import { BaseContext, test } from "../fixtures/db_connect.ts";

async function createTable(query: DbQuery, rowNum: number) {
  await query.query(
    `CREATE TABLE test(id INT PRIMARY KEY, num INT); INSERT INTO test(id) SELECT generate_series(0,${rowNum})`,
  );
}
const rowNum = 200;
const values: { id: number; num: number | null }[] = new Array(rowNum);
for (let i = 0; i < 200; i++) {
  values[i] = { id: i, num: null };
}
beforeEach<BaseContext>(async ({ emptyDbPool }) => {
  await createTable(emptyDbPool, 200);
});

test("通过异步迭代器读取所有数据", async function ({ emptyDbPool }) {
  const cursor = await emptyDbPool.cursor("SELECT * FROM test LIMIT 20", { defaultSize: 5 });
  await expect(Array.fromAsync(cursor), "异步迭代器").resolves.toEqual(values.slice(0, 20));
  expect(emptyDbPool.idleCount, "游标所在连接已被释放").toBe(emptyDbPool.totalCount);
});
test(
  "使用 await using 读取，在离开作用域时关闭游标",
  async function ({ emptyDbPool }) {
    async function usingRed() {
      await using cursor = await emptyDbPool.cursor("SELECT * FROM test LIMIT 20", {
        defaultSize: 5,
      });
      return cursor.read();
    }
    await expect(usingRed()).resolves.toEqual(values.slice(0, 5));
    expect(emptyDbPool.idleCount, "游标所在连接已被释放").toBe(emptyDbPool.totalCount);
  },
);
// 并行读取实现难度大，
test("不允许并行读取", async function ({ emptyDbPool }) {
  const cursor = await emptyDbPool.cursor("SELECT * FROM test LIMIT 20", {
    defaultSize: 5,
  });
  let p1 = cursor.read(5);
  await expect(cursor.read(5)).rejects.toThrowError(ParallelQueryError);
  await expect(p1).resolves.toEqual(values.slice(0, 5));
  await expect(cursor.read(5)).resolves.toEqual(values.slice(5, 10));

  await cursor.close();
  expect(emptyDbPool.idleCount, "游标所在连接已被释放").toBe(emptyDbPool.totalCount);
});
test("允许重复close", async function ({ emptyDbPool }) {
  const cursor = await emptyDbPool.cursor("SELECT * FROM test LIMIT 20", {
    defaultSize: 5,
  });

  expect(emptyDbPool.totalCount, "游标所在连接已被释放").toBe(1);
  expect(emptyDbPool.idleCount, "游标所在连接已被释放").toBe(0);
  await cursor.close();
  await cursor.close();
  expect(emptyDbPool.idleCount, "游标所在连接已被释放").toBe(emptyDbPool.totalCount);
});
