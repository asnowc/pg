import { test } from "@test/fixtures/db_connect.ts";
import { createSqlBuilder, JS_DATA_ENCODER_V1, PgPool } from "@asla/pg";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { expect } from "vitest";

test("使用示例", async () => {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1);
  const connectInfo = PUBLIC_DB_CONNECT_INFO;
  await using dbPool = new PgPool({
    create: async () => {
      const stream = await Deno.connect({ hostname: connectInfo.hostname, port: connectInfo.port });
      return {
        stream,
        connectOptions: { user: connectInfo.user, database: connectInfo.database, password: connectInfo.password },
      };
    },
    maxCount: 4,
  });

  const rows = await dbPool.query(sql`SELECT 1 AS value`).getRows();
  expect(rows).toEqual([{ value: 1 }]);
});
test("字符串擦好像", async ({ connect }) => {
  const rows = await connect.query(`SELECT 1 AS value`).getRows();
  expect(rows).toEqual([{ value: 1 }]);
});

test("事务依赖查询", async ({ conn }) => {
  await using t = conn.begin();
  const row = await t.query("SELECT 1").getFirstRow();
  if (row) {
    await t.query("SELECT 2");
  } else {
    await t.query("SELECT 3");
  }
  await t.commit();
});
test("事务非依赖查询", async ({ conn }) => {
  await using t = conn.begin();
  await Promise.all([
    t.query("SELECT 1"),
    t.query("SELECT 2"),
  ]);
  await t.commit();

  await conn.simpleQuery(`
    BEGIN;
    SELECT 1;
    SELECT 2;
    COMMIT;
  `);
});

test("流水线查询", async ({ conn }) => {
  await conn.query("CREATE TEMP TABLE t1 (c INT)");
  await conn.query("CREATE TEMP TABLE t2 (c INT)");

  // pool 可以使用
  const t1 = await conn
    .query("INSERT INTO t1 (c) VALUES (1)").getRows()
    .query("INSERT INTO t1 (c) VALUES (2)").getRows()
    .query("SELECT 1/0").getRows() //error
    .query("INSERT INTO t1 (c) VALUES (3)").getRows() //error
    .getRows();

  const count = await conn.query<{ count: number }>("SELECT COUNT(*)::INT AS count FROM t1").getFirstRow();
  expect(count).toEqual({ count: 2 });

  // 存在隐式事务，最终没有插入任何数据
  await conn.simpleQuery(`
    INSERT INTO t2 (c) VALUES (1);
    INSERT INTO t2 (c) VALUES (2);
    SELECT 1/0;
    INSERT INTO t2 (c) VALUES (3);
  `);
  const count2 = await conn.query<{ count: number }>("SELECT COUNT(*)::INT AS count FROM t2").getFirstRow();
  expect(count2).toEqual({ count: 0 });
});

test("query 和 simpleQuery 每次执行结束后不能处于事务中", async ({ pool, conn }) => {
  await pool.query("BEGIN"); // 链接释放后会导致下一个查询出现非预期状态
  await pool.simpleQuery("BEGIN"); // 链接释放后会导致下一个查询出现非预期状态

  await conn.query("BEGIN"); // 导致下一个查询出现非预期状态
  await conn.simpleQuery("BEGIN"); // 导致下一个查询出现非预期状态
});
interface Dummy<D extends any[]> {
  query<T>(): Dummy<[...D, T]>;
  then(onfulfilled?: (data: D) => void, onrejected?: (reason: unknown) => void): Promise<void>;
}
declare const dummy: Dummy<[]>;
const result = await dummy.query<number>().query<string>();
