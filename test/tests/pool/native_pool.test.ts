import { expect, test, vi } from "vitest";
import { createPgPool, type PgConnection, type QueryReader } from "@asla/pg";
import { QueryReaderImpl } from "@/query/QueryReaderImpl.ts";

class Reader<T> extends QueryReaderImpl<T> {
  override then(resolve?: (value: void) => void, reject?: (error: unknown) => void): void {
    this.getCompletion().then(() => resolve?.(), reject);
  }
}

function connection() {
  let closed = false;
  const query = vi.fn((_sql: unknown): QueryReader<unknown> =>
    new Reader(Promise.resolve({
      rows: [{ value: 1 }],
      fields: [],
      completion: { status: "complete", rowCount: 1, fields: [], notices: [] },
    }))
  );
  const dispose = vi.fn(async () => {
    closed = true;
  });
  const conn = {
    query,
    get closed() {
      return closed;
    },
    [Symbol.asyncDispose]: dispose,
  } as unknown as PgConnection;
  return {
    conn,
    query,
    dispose,
    disconnect: () => {
      closed = true;
    },
  };
}

test("maxCount 排队、release 幂等、释放后所有新操作被拒绝", async () => {
  const mock = connection();
  const create = vi.fn(async () => mock.conn);
  await using pool = createPgPool({ create, maxCount: 1 });
  const first = await pool.connect();
  let acquired = false;
  const pending = pool.connect().then((value) => {
    acquired = true;
    return value;
  });
  await Promise.resolve();
  expect(acquired).toBe(false);
  first.release();
  first.release();
  expect(first.released).toBe(true);
  expect(() => first.query("select 1")).toThrow("released");
  expect(() => first.simpleQuery("select 1")).toThrow("released");
  expect(() => first.queryStream()).toThrow("released");
  expect(() => first.openCursor("select 1")).toThrow("released");
  expect(() => first.begin()).toThrow("released");
  expect(() => first.copyFrom("COPY t FROM STDIN")).toThrow("released");
  expect(() => first.copyTo("COPY t TO STDOUT")).toThrow("released");
  const next = await pending;
  expect(create).toHaveBeenCalledTimes(1);
  await first[Symbol.asyncDispose]();
  expect(pool.idleCount).toBe(0);
  next.release();
});

test("QueryReader 延迟协议消费完成之前不归还，结果独立于之后的借用", async () => {
  const mock = connection();
  const rows = Promise.withResolvers<unknown[]>();
  const raw = mock.query("");
  raw.getRows = vi.fn(() => rows.promise);
  mock.query.mockReturnValue(raw);
  await using pool = createPgPool({ create: async () => mock.conn, maxCount: 1 });
  const result = pool.query("select 1");
  await vi.waitFor(() => expect(raw.getRows).toHaveBeenCalled());
  let acquired = false;
  const pending = pool.connect().then((value) => {
    acquired = true;
    return value;
  });
  await Promise.resolve();
  expect(acquired).toBe(false);
  rows.resolve([{ value: 42 }]);
  const next = await pending;
  expect(await result.getFirstRow()).toEqual({ value: 42 });
  await expect(result.getRows()).rejects.toThrow("consumed");
  next.release();
});

test("显式 release 和 asyncDispose 等待已经发起的查询", async () => {
  const mock = connection();
  const rows = Promise.withResolvers<unknown[]>();
  const raw = mock.query("");
  raw.getRows = () => rows.promise;
  mock.query.mockReturnValue(raw);
  await using pool = createPgPool({ create: async () => mock.conn, maxCount: 1 });
  const borrowed = await pool.connect();
  const query = borrowed.query("select 1");
  const closing = borrowed[Symbol.asyncDispose]();
  expect(borrowed.released).toBe(true);
  expect(pool.idleCount).toBe(0);
  rows.resolve([]);
  await query;
  await closing;
  expect(pool.idleCount).toBe(1);
});

test("query 支持 await、元数据和迭代完成值", async () => {
  const mock = connection();
  await using pool = createPgPool({ create: async () => mock.conn });
  const query = pool.query<{ value: number }>("select 1");
  await query;
  expect(await query.getRowCount()).toBe(1);
  expect(await query.getFields()).toEqual([]);
  expect(await query.getMap("value")).toEqual(new Map([[1, { value: 1 }]]));
  const iterator = pool.query("select 1")[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toEqual({ value: 1 });
  expect(await iterator.next()).toMatchObject({ done: true, value: { status: "complete" } });
});

test("失效连接释放后为等待者建连，usageLimit 关闭物理连接", async () => {
  const first = connection();
  const second = connection();
  const create = vi.fn().mockResolvedValueOnce(first.conn).mockResolvedValueOnce(second.conn);
  await using pool = createPgPool({ create, maxCount: 1, usageLimit: 1 });
  const borrowed = await pool.connect();
  const pending = pool.connect();
  first.disconnect();
  borrowed.release();
  const next = await pending;
  next.release();
  expect(pool.totalCount).toBe(0);
  expect(second.dispose).toHaveBeenCalledTimes(1);
});

test("池关闭等待注入连接的物理关闭，拒绝排队和新请求", async () => {
  const mock = connection();
  const physicalClose = Promise.withResolvers<void>();
  mock.dispose.mockImplementation(() => physicalClose.promise);
  const pool = createPgPool({ create: async () => mock.conn, maxCount: 1 });
  const borrowed = await pool.connect();
  const pending = pool.connect();
  const closing = pool[Symbol.asyncDispose]();
  expect(pool[Symbol.asyncDispose]()).toBe(closing);
  await expect(pending).rejects.toThrow("closed");
  await expect(pool.connect()).rejects.toThrow("closed");
  expect(() => pool.query("select 1")).toThrow("closed");
  let closed = false;
  closing.then(() => {
    closed = true;
  });
  borrowed.release();
  await Promise.resolve();
  expect(closed).toBe(false);
  physicalClose.resolve();
  await closing;
});

test("建连失败及同步 query 异常不泄漏", async () => {
  const mock = connection();
  const create = vi.fn().mockRejectedValueOnce(new Error("connect failed")).mockResolvedValue(mock.conn);
  await using pool = createPgPool({ create, maxCount: 1 });
  const first = pool.query("select 1");
  const second = pool.query("select 2");
  await expect(first.getRows()).rejects.toThrow("connect failed");
  await second;
  mock.query.mockImplementationOnce(() => {
    throw new Error("query failed");
  });
  await expect(pool.query("select 3").getRows()).rejects.toThrow("query failed");
  expect(pool.idleCount).toBe(1);
});

test("空事务不建连，事务开始失败和结束失败均释放", async () => {
  const mock = connection();
  const create = vi.fn(async () => mock.conn);
  await using pool = createPgPool({ create });
  const empty = pool.begin();
  await empty.rollback();
  expect(create).not.toHaveBeenCalled();
  expect(() => empty.query("select 1")).toThrow("released");
  const tx = pool.begin();
  await tx.query("select 1");
  mock.query.mockImplementationOnce(() => {
    throw new Error("commit failed");
  });
  await expect(tx.commit()).rejects.toThrow("commit failed");
  expect(pool.totalCount).toBe(0);
  expect(mock.dispose).toHaveBeenCalledTimes(1);
});

test("无效配置在建连前拒绝", () => {
  const create = async () => connection().conn;
  expect(() => createPgPool({ create, maxCount: 0 })).toThrow(RangeError);
  expect(() => createPgPool({ create, usageLimit: -1 })).toThrow(RangeError);
  expect(() => createPgPool({ create, idleTimeout: NaN })).toThrow(RangeError);
});

test("queryStream 获取连接期间取消也会释放，后续等待者不会悬挂", async () => {
  const mock = connection();
  const created = Promise.withResolvers<PgConnection>();
  await using pool = createPgPool({ create: () => created.promise, maxCount: 1 });
  const stream = pool.queryStream();
  const cancel = stream.readable.cancel("stop");
  const next = pool.connect();
  created.resolve(mock.conn);
  await cancel;
  (await next).release();
  expect(pool.idleCount).toBe(1);
});

test("queryStream abort 写端归还连接并使读端失败", async () => {
  const mock = connection();
  await using pool = createPgPool({ create: async () => mock.conn });
  const stream = pool.queryStream();
  const read = stream.readable.getReader().read();
  const failed = expect(read).rejects.toBe("stop");
  await stream.writable.abort("stop");
  await failed;
  expect(pool.idleCount).toBe(1);
});

test("COPY OUT 获取连接期间取消会等待租约并销毁连接", async () => {
  const mock = connection();
  const cancelled = vi.fn();
  mock.conn.copyTo = () => new ReadableStream<Uint8Array>({ cancel: cancelled });
  const created = Promise.withResolvers<PgConnection>();
  await using pool = createPgPool({ create: () => created.promise });
  const stream = pool.copyTo("COPY t TO STDOUT");
  const cancellation = stream.cancel("stop");
  created.resolve(mock.conn);
  await cancellation;
  expect(cancelled).toHaveBeenCalledWith("stop");
  expect(mock.dispose).toHaveBeenCalledTimes(1);
  expect(pool.totalCount).toBe(0);
});

test("各种延迟资源的建连失败均被传递且无借出泄漏", async () => {
  await using pool = createPgPool({
    create: async () => {
      throw new Error("connect failed");
    },
  });
  const cursor = pool.openCursor("select 1");
  await expect(cursor.fields).rejects.toThrow("connect failed");
  await expect(cursor.completion).rejects.toThrow("connect failed");
  await expect(cursor.close()).rejects.toThrow("connect failed");
  const copy = pool.copyFrom("COPY t FROM STDIN");
  await expect(copy.complete).rejects.toThrow("connect failed");
  await expect(copy.write(new Uint8Array())).rejects.toThrow();
  await expect(pool.copyTo("COPY t TO STDOUT").getReader().read()).rejects.toThrow("connect failed");
  await expect(Array.fromAsync(pool.simpleQuery("select 1"))).rejects.toThrow("connect failed");
  const stream = pool.queryStream();
  await expect(stream.readable.getReader().read()).rejects.toThrow("connect failed");
  await expect(stream.writable.getWriter().close()).rejects.toThrow();
  const tx = pool.begin();
  await expect(tx.query("select 1").getRows()).rejects.toThrow("connect failed");
  await expect(tx.rollback()).rejects.toThrow("connect failed");
  expect(pool.totalCount).toBe(0);
});

test("池配置 idleTimeout 会关闭空闲物理连接", async () => {
  const mock = connection();
  await using pool = createPgPool({ create: async () => mock.conn, idleTimeout: 5 });
  (await pool.connect()).release();
  await vi.waitFor(() => expect(mock.dispose).toHaveBeenCalledTimes(1));
  expect(pool.totalCount).toBe(0);
});

test("COPY 写失败即使底层 complete 尚未解决，也淘汰连接并唤醒等待者", async () => {
  const first = connection();
  const second = connection();
  const failure = new Error("write failed");
  const abort = vi.fn(async () => {});
  first.conn.copyFrom = () => ({
    write: async () => {
      throw failure;
    },
    closeWrite: async () => ({ rows: 0 }),
    abort,
    writable: new WritableStream(),
    complete: new Promise(() => {}),
  });
  const create = vi.fn().mockResolvedValueOnce(first.conn).mockResolvedValueOnce(second.conn);
  await using pool = createPgPool({ create, maxCount: 1 });
  const copy = pool.copyFrom("COPY t FROM STDIN");
  const next = pool.connect();
  await expect(copy.write(new Uint8Array([1]))).rejects.toBe(failure);
  await expect(copy.complete).rejects.toBe(failure);
  (await next).release();
  expect(abort).toHaveBeenCalledWith(failure);
  expect(first.dispose).toHaveBeenCalledTimes(1);
});

test("BEGIN 失败淘汰连接，关闭事务和池不悬挂", async () => {
  const mock = connection();
  mock.query.mockImplementationOnce(() => {
    throw new Error("begin failed");
  });
  await using pool = createPgPool({ create: async () => mock.conn });
  const tx = pool.begin();
  await expect(tx.query("select 1").getRows()).rejects.toThrow("begin failed");
  await expect(tx.rollback()).rejects.toThrow("begin failed");
  expect(pool.totalCount).toBe(0);
  expect(mock.dispose).toHaveBeenCalledTimes(1);
});
