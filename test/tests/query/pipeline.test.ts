import { test } from "@test/fixtures/db_connect.ts";
import { expect } from "vitest";
import { PgDatabaseError } from "@asla/pg";

test("孤立语句查询", async ({ conn }) => {
  //适用与互不干扰的查询场景，语句执行失败，不会影响其他语句的执行
  await conn.query("CREATE TEMP TABLE t(c VARCHAR)");

  await conn.query("INSERT INTO t(c) VALUES ('s1')"); // ok
  await expect(conn.query("SELECT 1/0").rowCount()).rejects.toThrow(PgDatabaseError); // error
  await conn.query("INSERT INTO t(c) VALUES ('s2')"); // ok

  await expect(conn.query("SELECT * FROM tWHERE c = 's1'").rowCount()).resolves.toBe(1);
  await expect(conn.query("SELECT * FROM tWHERE c = 's2'").rowCount()).resolves.toBe(1);
});

test("孤立语句流水线查询", async ({ conn }) => {
  await conn.query("CREATE TEMP TABLE t(c VARCHAR)");
  //下面会触发流水线查询, 语句执行失败不会影响其他语句的执行
  await Promise.all([
    conn.query("INSERT INTO t(c) VALUES ('p1')"), // ok
    reversePromise(conn.query("SELECT 1/0")), // error
    conn.query("INSERT INTO t(c) VALUES ('p2')"), // ok
  ]);
  await expect(conn.query("SELECT * FROM tWHERE c = 'p1'").rowCount()).resolves.toBe(1);
  await expect(conn.query("SELECT * FROM tWHERE c = 'p2'").rowCount()).resolves.toBe(1);
});
test("依赖语句型流水线查询", async ({ conn }) => {
  // 查询语句要求前面的语句成功执行，否则会导致后续语句失败

  await conn.query("CREATE TEMP TABLE t(c VARCHAR)");

  await Promise.all([
    conn.pipeline("INSERT INTO t(c) VALUES ('p1')"),
    conn.pipeline("SELECT 1/0"),
    conn.pipeline("INSERT INTO t(c) VALUES ('p2')"),
  ]);
  await expect(conn.query("SELECT * FROM tWHERE c = 'p1'").rowCount()).resolves.toBe(1);
  await expect(conn.query("SELECT * FROM tWHERE c = 'p2'").rowCount()).resolves.toBe(0);

  // 与 PostgreSQL 的简单查询类似，但由于简单查询存在隐式事务，最终没有插入任何数据。但实际第一条语句能够成功返回
  await conn.queryMultiple(`
    INSERT INTO t(c) VALUES ('s1') RETURNING *;
    SELECT 1/0;
    INSERT INTO t(c) VALUES ('s2') RETURNING *;
  `);
  await expect(conn.query("SELECT * FROM tWHERE c = 's1'").rowCount()).resolves.toBe(0);
  await expect(conn.query("SELECT * FROM tWHERE c = 's2'").rowCount()).resolves.toBe(0);
});

test("孤立语句事务查询", async ({ conn }) => {
  {
    await conn.query("CREATE TEMP TABLE t(c VARCHAR)");
    await using t = conn.begin();

    // 不依赖结果，直接通过流水线查询
    await Promise.all([
      conn.query("INSERT INTO t(c) VALUES ('p1')"),
      conn.query("INSERT INTO t(c) VALUES ('p2')"),
      t.commit(),
    ]);
  }
  {
    // 多语句查询也可以
    await conn.queryMultiple(`
        BEGIN;
        INSERT INTO t(c) VALUES ('p1');
        INSERT INTO t(c) VALUES ('p2');
        COMMIT;
      `);
  }
});

test("事务中流水线语句执行出错", async ({ conn }) => {
  // 当事务中流水线执行语句出错时，会跳过后续语句.
  // 下面的两个实例中，是等价的，最后释放连接前会自动发送 ROLLBACK 语句以恢复连接

  await conn.query("CREATE TEMP TABLE t(c VARCHAR)");

  await using t = conn.begin();

  const [a1, a2, a3, a4] = await Promise.allSettled([
    t.query("INSERT INTO t(c) VALUES ('p1')"),
    t.query("SELECT 1/0"), // error
    t.query("INSERT INTO t(c) VALUES ('p2')"), // 跳过
    t.commit(), // 跳过
  ]);
});
test("事务流水线恢复异常", async ({ conn }) => {
  await conn.query("CREATE TEMP TABLE t(c VARCHAR)");
  // 最后释放连接前会自动发送 ROLLBACK 语句以恢复连接

  await expect(conn.query("SELECT * FROM t WHERE c = 'p1'").rowCount()).resolves.toBe(0);

  await using t = conn.begin();

  await Promise.allSettled([
    t.query("INSERT INTO t(c) VALUES ('p1')"),
    t.savePoint("P1"),
    t.query("SELECT 1/0"), // error
    t.query("INSERT INTO t(c) VALUES ('p2')"), // 跳过
    t.commit(), // 跳过
  ]);
  await Promise.all([
    t.rollbackTo("P1"),
    t.commit(),
  ]);
  await expect(conn.query("SELECT * FROM t WHERE c = 'p1'").rowCount()).resolves.toBe(1);
});

test("依赖语句结果的事务查询", async ({ conn }) => {
  await conn.query("CREATE TEMP TABLE user (id INT)");
  await using t = conn.begin();
  const count = await t.query("SELECT * FROM user WHERE id= 1").rowCount();

  if (count) await t.query("SELECT 2");
  else await t.query("SELECT 3");

  await Promise.all([
    t.query("SELECT 4"),
    t.commit(),
  ]);
});

test("query 和 simpleQuery 每次执行结束后不能处于事务中", async ({ pool, conn }) => {
  await pool.query("BEGIN"); // 链接释放后会导致下一个查询出现非预期状态
  await conn.query("BEGIN"); // 导致下一个查询出现非预期状态
});
test("query 和 simpleQuery 每次执行结束后不能处于事务中", async ({ pool, conn }) => {
  await pool.queryMultiple("BEGIN"); // 链接释放后会导致下一个查询出现非预期状态
  await conn.queryMultiple("BEGIN"); // 导致下一个查询出现非预期状态
});
function reversePromise(
  promise: { then(res?: (value: any) => Promise<any>, reject?: (e: any) => void): Promise<unknown> },
): Promise<void> {
  return promise.then((): never => {
    throw new Error("Promise was expected to be rejected");
  }, () => {});
}
