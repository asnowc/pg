import { expect } from "vitest";
import { test } from "../fixtures/db_connect.ts";
import type { DbQuery, QueryRowsResult } from "@asla/pg";
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
test(
  "使用 using 在离开作用域时未提交或回滚事务，则自动回滚，并释放连接",
  async function ({ emptyDbPool }) {
    await createTable(emptyDbPool, 200);
    async function start() {
      await using conn = emptyDbPool.begin();
      await conn.query("UPDATE test set num=8 WHERE id=0");
    }
    await start();
    const result = await emptyDbPool.queryMap<{ id: number; num: number | null }>(
      "SELECT * from test WHERE id=1",
      "id",
    );
    await expect(result.get(1)?.num).toBe(null);
    expect(emptyDbPool.idleCount, "游标所在连接已被释放").toBe(1);
  },
);
test("开始事务，并提交事务", async function ({ emptyDbPool }) {
  await createTable(emptyDbPool, 10);
  async function start() {
    await using conn = emptyDbPool.begin();
    const result = await conn.query<QueryRowsResult<any>>(
      "UPDATE test set num=8 WHERE id=1 RETURNING *",
    );
    await conn.commit();
    return result.rows[0];
  }
  await start();
  const result = await emptyDbPool.queryMap<{ id: number; num: number | null }>(
    "SELECT * from test WHERE id=1",
    "id",
  );
  await expect(result.get(1)?.num).toBe(8);
});

test("事务中途出错自动释放后，再次使用该连接", async function ({ emptyDbPool }) {
  await createTable(emptyDbPool, 10);
  const transaction = emptyDbPool.begin();
  await expect(transaction.query("SELECT * from tx")).rejects.toThrowError();
  expect(emptyDbPool.idleCount).toBe(1);
  using conn = await emptyDbPool.connect();
  const { rows } = await conn.query("SELECT * from test");
  expect(rows.length).not.toBe(10);
});

test("执行出错，试图再次 rollback", async function ({ emptyDbPool }) {
  async function start() {
    const conn = emptyDbPool.begin();
    try {
      await conn.query("aaa"); // 执行出错
    } catch (error) {
      await conn.rollback(); // rollback()
    }
  }
  await expect(start()).resolves.toBeUndefined();
});
