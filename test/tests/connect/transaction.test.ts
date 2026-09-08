import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import type { TransactionMode } from "@asla/pg";
import { PgTransactionStatus } from "@/protocol/pg_message.ts";

test("await reader 等待执行、传播错误且不消耗结果", async ({ connect }) => {
  const reader = connect.query<{ value: number }>("SELECT 42::int AS value");
  expect(await reader).toBeUndefined();
  await expect(reader.getRows()).resolves.toEqual([{ value: 42 }]);
  await expect(Promise.resolve(connect.query("SELECT 1 / 0"))).rejects.toThrow();
  await connect.query("CREATE TEMP TABLE await_reader(id int)");
  await expect(connect.query("SELECT * FROM await_reader").getRows()).resolves.toEqual([]);
});

test("未使用事务惰性启动，重复结束不发送 SQL", async ({ connect }) => {
  await using tx = connect.begin();
  expect(tx.mode).toBe("READ COMMITTED");
  expect(connect.session.transactionStatus).toBe(PgTransactionStatus.Idle);
  await tx.rollback();
  await tx.rollback();
  await tx.commit();
  expect(tx.released).toBe(true);
  expect(() => tx.query("SELECT 1")).toThrow("released");
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});

for (const mode of ["SERIALIZABLE", "REPEATABLE READ", "READ COMMITTED", "READ UNCOMMITTED"] as const) {
  test(`原生事务使用真实隔离级别 ${mode}`, async ({ connect }) => {
    await using tx = connect.begin(mode);
    await expect(tx.query("SHOW transaction_isolation").getFirstRow()).resolves.toEqual({
      transaction_isolation: mode.toLowerCase(),
    });
    expect(connect.session.transactionStatus).toBe(PgTransactionStatus.Transaction);
    await tx.commit();
    expect(connect.session.transactionStatus).toBe(PgTransactionStatus.Idle);
  });
}

test("事务提交持久化，普通连接查询在事务结束后执行", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE tx_commit(id int)");
  await using tx = connect.begin();
  const inserted = tx.query("INSERT INTO tx_commit VALUES (1)");
  let outsideFinished = false;
  const outside = connect.query("SELECT * FROM tx_commit").getRows().then((rows) => {
    outsideFinished = true;
    return rows;
  });
  await inserted;
  expect(outsideFinished).toBe(false);
  await tx.commit();
  await expect(outside).resolves.toEqual([{ id: 1 }]);
  await tx.commit();
  expect(() => tx.openCursor("SELECT 1")).toThrow("released");
});

test("立即提交等待已排队事务查询", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE tx_pending(id int)");
  await using tx = connect.begin();
  const first = tx.query("INSERT INTO tx_pending VALUES (1)");
  const second = tx.query("INSERT INTO tx_pending VALUES (2)");
  await tx.commit();
  await Promise.all([first, second]);
  await expect(connect.query("SELECT * FROM tx_pending ORDER BY id").getRows()).resolves.toEqual([{ id: 1 }, {
    id: 2,
  }]);
});

test("await using 离开作用域自动回滚", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE tx_rollback(id int)");
  {
    await using tx = connect.begin();
    await tx.query("INSERT INTO tx_rollback VALUES (1)");
  }
  expect(connect.session.transactionStatus).toBe(PgTransactionStatus.Idle);
  await expect(connect.query("SELECT * FROM tx_rollback").getRows()).resolves.toEqual([]);
});

test("保存点正确转义名称，错误后回滚到保存点可继续提交", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE tx_savepoint(id int)");
  await using tx = connect.begin();
  await tx.query("INSERT INTO tx_savepoint VALUES (1)");
  const name = 'point"; SELECT 1; --';
  await tx.savePoint(name);
  await tx.query("INSERT INTO tx_savepoint VALUES (2)");
  await expect(tx.query("SELECT 1 / 0").getRows()).rejects.toThrow();
  expect(connect.session.transactionStatus).toBe(PgTransactionStatus.Failed);
  await tx.rollbackTo(name);
  await tx.query("INSERT INTO tx_savepoint VALUES (3)");
  await tx.commit();
  await expect(connect.query("SELECT * FROM tx_savepoint ORDER BY id").getRows()).resolves.toEqual([{ id: 1 }, {
    id: 3,
  }]);
});

test("失败事务不能伪装提交成功，回滚后连接可复用", async ({ connect }) => {
  await connect.query("CREATE TEMP TABLE tx_failed(id int)");
  await using tx = connect.begin();
  await tx.query("INSERT INTO tx_failed VALUES (1)");
  await expect(tx.query("SELECT 1 / 0").getRows()).rejects.toThrow();
  await expect(tx.commit()).rejects.toThrow("aborted transaction");
  expect(tx.released).toBe(true);
  await expect(connect.query("SELECT * FROM tx_failed").getRows()).resolves.toEqual([]);
});

test("事务回滚关闭未耗尽游标并释放连接队列", async ({ connect }) => {
  await using tx = connect.begin();
  const cursor = tx.openCursor<{ n: number }>("SELECT generate_series(1, 5)::int AS n");
  await expect(cursor.read(2)).resolves.toEqual([{ n: 1 }, { n: 2 }]);
  await tx.rollback();
  expect(cursor.isClosed).toBe(true);
  await expect(cursor.completion).resolves.toMatchObject({ status: "closed" });
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});

test("事务游标完整读取并提交", async ({ connect }) => {
  await using tx = connect.begin();
  await using cursor = tx.openCursor<{ n: number }>("SELECT generate_series(1, 3)::int AS n", { iteratorMaxRows: 2 });
  await expect(Array.fromAsync(cursor)).resolves.toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
  await tx.commit();
  expect(connect.session.transactionStatus).toBe(PgTransactionStatus.Idle);
});

test("拒绝非法隔离级别和已存在的手工事务，不破坏连接", async ({ connect }) => {
  expect(() => connect.begin("READ COMMITTED; SELECT 1" as TransactionMode)).toThrow("isolation level");
  await connect.query("BEGIN");
  const tx = connect.begin();
  await expect(tx.query("SELECT 1").getRows()).rejects.toThrow("active transaction");
  await expect(tx.rollback()).rejects.toThrow("active transaction");
  await connect.query("ROLLBACK");
  await expect(connect.query("SELECT 1").getRowCount()).resolves.toBe(1);
});
