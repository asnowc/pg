import {
  ConnectionNotAvailableError,
  createDbPoolTransaction,
  DbPoolTransaction,
  ParallelQueryError,
  SqlLike,
} from "#abstract";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { createMoDbPoolConnection } from "./__mocks__/db_connection.ts";

test("未进行任何操作，直接 rollback() 会被忽略，且不获取连接", async function () {
  const conn = vi.fn();
  const transaction = createDbPoolTransaction(conn);
  await expect(transaction.rollback()).resolves.toBeUndefined();
  expect(conn).not.toBeCalled();
});
test("未进行任何操作，直接 commit() 会被忽略，且不获取连接", async function () {
  const conn = vi.fn();
  const transaction = createDbPoolTransaction(conn);
  await expect(transaction.commit()).resolves.toBeUndefined();
  expect(conn).not.toBeCalled();
});
test("rollback() 后直接释放连接", async function () {
  const { poolConn, onRelease } = createMoDbPoolConnection();
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect);

  await transaction.query("SELECT count(*) FROM test");
  await transaction.rollback();
  expect(onRelease).toBeCalledTimes(1);
});
test("commit() 直接释放连接", async function () {
  const { poolConn, onRelease } = createMoDbPoolConnection();
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect);

  await transaction.query("SELECT count(*) FROM test");
  await transaction.commit();
  expect(onRelease).toBeCalledTimes(1);
});
test("第一条语句与 begin 合并发生", async function () {
  const { poolConn, mockConn } = createMoDbPoolConnection();
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect);

  await transaction.query("SELECT count(*) FROM test");
  expect(mockConn.query, "BEGIN 和 query 合并发生").toBeCalledTimes(1);
});
test("多次 commit() 或 rollback() 会被忽略", async function () {
  const { poolConn, mockConn, onRelease } = createMoDbPoolConnection();
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect);

  await transaction.query("SELECT count(*) FROM test");
  await transaction.commit();
  expect(mockConn.query).toBeCalledTimes(1);
  expect(mockConn.execute).toBeCalledTimes(1);
  await transaction.commit();
  await transaction.rollback();
  await transaction.rollback();
  expect(mockConn.query).toBeCalledTimes(1);
  expect(mockConn.execute).toBeCalledTimes(1);
  expect(onRelease).toBeCalledTimes(1);
});
test("不允许并行查询", async function () {
  const { poolConn, mockConn } = createMoDbPoolConnection();
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect);

  const p1 = transaction.query("SELECT count(*) FROM test");
  await expect(transaction.query("SELECT count(*) FROM test")).rejects.toThrowError(ParallelQueryError);
  expect(mockConn.query).toBeCalledTimes(1);

  await p1;
  await expect(transaction.query("SELECT count(*) FROM test")).resolves.not.toBeUndefined();
  expect(mockConn.query).toBeCalledTimes(2);
});

describe("事务执行出错", function () {
  let conn: ReturnType<typeof createMoDbPoolConnection>;
  let transaction: DbPoolTransaction;
  beforeEach(function () {
    conn = createMoDbPoolConnection();
    transaction = createDbPoolTransaction(vi.fn(async () => conn.poolConn));
  });
  test("事务第1条执行出错，应释放连接", async function ({}) {
    const { onRelease, poolConn } = conn;
    await expect(transaction.query("error sql")).rejects.toThrowError();
    expect(onRelease).toBeCalledTimes(1);
    expect(poolConn.released).toBe(true);
  });
  test("事务第2条执行出错，应释放连接", async function () {
    const { onRelease, poolConn } = conn;
    await transaction.query("abc");

    await expect(transaction.query("error sql")).rejects.toThrowError();
    expect(onRelease).toBeCalledTimes(1);
    expect(poolConn.released).toBe(true);
  });
  test("执行出错，试图再次 rollback", async function () {
    const { mockConn } = conn;
    await expect(transaction.query("error sql")).rejects.toThrowError();
    const callCount = mockConn.query.mock.calls.length;
    await transaction.rollback(); // rollback()
    expect(mockConn.query.mock.calls.length, "rollback() 被忽略").toBe(callCount);
  });

  test("第一条连接错误，不应调用 release", async function () {
    const transaction = createDbPoolTransaction(vi.fn(async () => Promise.reject(new Error("connect error"))));
    await expect(transaction.query("abc")).rejects.toThrowError("connect error");
    await expect(transaction.query("def"), "第一天语句因连接失败，事务应该被丢弃").rejects.toThrowError(
      ConnectionNotAvailableError,
    );
    await expect(transaction.rollback()).resolves.toBeUndefined();
  });
});
test("连接完成前 rollback()，应能被释放连接", async function () {
  const { poolConn, onRelease } = createMoDbPoolConnection();
  const transaction = createDbPoolTransaction(async () => poolConn, { errorRollback: true });

  const abc = transaction.query("abc");
  await transaction.rollback(); // 连接成功之前 rollback()

  await expect(abc).rejects.toThrowError(ConnectionNotAvailableError);
  expect(onRelease).toBeCalledTimes(1);
});
test("连接完成前 commit()，应能被释放连接", async function () {
  const { poolConn, onRelease } = createMoDbPoolConnection();
  const transaction = createDbPoolTransaction(async () => poolConn, { errorRollback: true });

  const abc = transaction.query("abc");
  await transaction.commit(); // 连接成功之前 rollback()

  await expect(abc).rejects.toThrowError(ConnectionNotAvailableError);
  expect(onRelease).toBeCalledTimes(1);
});
test("errorRollback 为 true, 事务第1条执行出错，应释放连接, 并发送回滚", async function () {
  const { poolConn, mockConn, onRelease } = createMoDbPoolConnection();
  const transaction = createDbPoolTransaction(async () => poolConn, { errorRollback: true });

  await expect(transaction.query("error sql")).rejects.toThrowError();
  expect(onRelease).toBeCalledTimes(1);
  expect(mockConn.query).toBeCalledTimes(1);
  expect(mockConn.execute).toBeCalledTimes(1);
  expect(mockConn.execute.mock.calls[0][0]).toBe("ROLLBACK");
});

test("errorRollback 为 true, 事务第2条执行出错，应释放连接, 并发送回滚", async function () {
  const { poolConn, mockConn, onRelease } = createMoDbPoolConnection();
  const transaction = createDbPoolTransaction(async () => poolConn, { errorRollback: true });

  await transaction.query("abc");
  await expect(transaction.query("error sql")).rejects.toThrowError();
  expect(onRelease).toBeCalledTimes(1);

  expect(mockConn.query).toBeCalledTimes(2);
  expect(mockConn.execute).toBeCalledTimes(1);
  expect(mockConn.execute.mock.calls[0][0]).toBe("ROLLBACK");
});

test("query() 事务中查询单条语句", async function () {
  const { poolConn, mockConn } = createMoDbPoolConnection();
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect);

  mockConn.query.mockResolvedValueOnce([
    { rowCount: 1, rows: null }, //begin
    { rowCount: 1, rows: [{ count: 1 }] },
  ]);

  {
    const result = await transaction.queryRows("SELECT count(*) FROM test");
    expect(result).toEqual([{ count: 1 }]);
  }

  mockConn.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 2 }] });
  {
    const result = await transaction.queryRows("SELECT count(*) FROM test2");
    expect(result).toEqual([{ count: 2 }]);
  }
});
describe("queryRows", function () {
  test("第一条语句与 begin 合并发生", async function () {
    const { poolConn, mockConn } = createMoDbPoolConnection();
    const connect = vi.fn(async () => poolConn);
    const transaction = createDbPoolTransaction(connect);

    await transaction.queryRows("SELECT count(*) FROM test");
    expect(mockConn.query.mock.calls[0][0]).toEqual(["BEGIN", "SELECT count(*) FROM test"]);
    await transaction.queryRows("SELECT count(*) FROM test2");
    expect(mockConn.query.mock.calls[1][0]).toBe("SELECT count(*) FROM test2");
  });
});
describe("query() 事务中查询多条语句", function () {
  test("query() 事务中查询多条语句", async function () {
    const { poolConn, mockConn } = createMoDbPoolConnection();
    const connect = vi.fn(async () => poolConn);
    const transaction = createDbPoolTransaction(connect);

    mockConn.query.mockResolvedValueOnce([
      { rowCount: 1, rows: null }, //begin
      { rowCount: 1, rows: [{ count: 1 }] },
      { rowCount: 1, rows: [{ count: 2 }] },
    ]);

    {
      const result = await transaction.query(["SELECT count(*) FROM test", "SELECT count(*) FROM test2"]);
      expect(result).toEqual([
        { rowCount: 1, rows: [{ count: 1 }] },
        { rowCount: 1, rows: [{ count: 2 }] },
      ]);
    }

    mockConn.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ count: 1 }] });
    {
      const result = await transaction.query("SELECT count(*) FROM test");
      expect(result).toEqual({ rowCount: 1, rows: [{ count: 1 }] });
    }
  });
  test("query() 按原样传递数组 sql", async function () {
    const { poolConn, mockConn } = createMoDbPoolConnection();
    const connect = vi.fn(async () => poolConn);
    const transaction = createDbPoolTransaction(connect);

    await transaction.query(["SELECT count(*) FROM test", "SELECT count(*) FROM test2"]);
    expect(mockConn.query.mock.calls[0][0]).toEqual([
      "BEGIN",
      "SELECT count(*) FROM test",
      "SELECT count(*) FROM test2",
    ]);
    await transaction.query(["SELECT count(*) FROM test", "SELECT count(*) FROM test2"]);
    expect(mockConn.query.mock.calls[1][0]).toEqual(["SELECT count(*) FROM test", "SELECT count(*) FROM test2"]);
  });
});

test("rollback() 抛出异常时，连接会被断开", async function () {
  const { poolConn, mockConn, onDispose } = createMoDbPoolConnection();
  mockConn.execute.mockImplementationOnce(async (sql: SqlLike | SqlLike[]) => {
    if (sql === "ROLLBACK") throw new Error("rollback error");
  });
  const connect = vi.fn(async () => poolConn);
  const transaction = createDbPoolTransaction(connect, { errorRollback: true });
  await transaction.query("SELECT 1");
  await expect(transaction.query("error sql")).rejects.toThrowError();
  expect(onDispose).toBeCalledTimes(1);
});
