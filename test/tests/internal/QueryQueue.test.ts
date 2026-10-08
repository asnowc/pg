import { expect, test, vi } from "vitest";
import { MessageTest } from "@test/mock/MessageTypeParser.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { PgDatabaseError } from "@/error.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { BackendMessageCode as B, FrontendMessageCode as F, PgTransactionStatus as Status } from "@/protocol/const.ts";
import { QueryResultParser } from "@/protocol/parsers/QueryResultParser.ts";
import { ReceiverType } from "@/protocol/parsers/QueryTask.ts";

const statement = createTypeSqlStatementEncoder("SELECT 1");
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const extended = [F.Execute, F.Flush];
const pullExtended = [F.Execute, F.Flush, F.Sync];

async function drained(t: MessageTest) {
  await vi.waitFor(() => expect(t.writeQueue.hasPending).toBe(false));
}

function observe<T>(promise: Promise<T>) {
  const result = vi.fn();
  promise.then(result, result);
  return { promise, result };
}
function catchPromise<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

test("事务外扩展查询分别带 Sync，不等待 ReadyForQuery 即全部发送", async () => {
  const t = new MessageTest();
  t.writeQueue.extendedQuery(statement);
  t.writeQueue.extendedQuery(statement);
  t.writeQueue.extendedQuery(statement);
  await expect(t.onWriteFree()).resolves.toEqual([...pullExtended, ...pullExtended, ...pullExtended]);
});

test("事务前后带 Sync，事务中查询无 Sync", async () => {
  const t = new MessageTest();
  t.writeQueue.extendedQuery(statement);
  t.writeQueue.beginTransaction("SERIALIZABLE");
  t.writeQueue.extendedQuery(statement);
  t.writeQueue.extendedQuery(statement);
  t.writeQueue.endTransaction();
  t.writeQueue.extendedQuery(statement);
  await expect(t.onWriteFree()).resolves.toEqual([
    ...pullExtended,
    F.Execute,
    ...extended,
    ...extended,
    F.Execute,
    F.Sync,
    ...pullExtended,
  ]);
});

test("首个事务不发送前置 Sync，相邻事务复用结束 Sync", async () => {
  const t = new MessageTest();
  t.writeQueue.beginTransaction();
  t.writeQueue.endTransaction();
  t.writeQueue.beginTransaction();
  t.writeQueue.endTransaction(true);
  expect(await t.onWriteFree()).toEqual([F.Execute, F.Execute, F.Sync, F.Execute, F.Execute, F.Sync]);
  expect(t.writeQueue.hasPending).toBe(false);
});

test("写队列为空且读队列以 Sync 结束时，开启事务不重复发送 Sync", async () => {
  const t = new MessageTest();
  void t.writeQueue.extendedQuery(statement);
  await expect(t.onWriteFree()).resolves.toEqual(pullExtended);
  t.writeQueue.beginTransaction();
  t.writeQueue.endTransaction();
  await expect(t.onWriteFree()).resolves.toEqual([...pullExtended, F.Execute, F.Execute, F.Sync]);
});

test("写队列队尾为简单查询时，开启事务立即拒绝且不发送 BEGIN 或 Sync", async () => {
  const t = new MessageTest();
  void t.writeQueue.simpleQuery(statement);
  expect(() => t.writeQueue.beginTransaction()).toThrow(/write queue must end with Sync/);
  await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query]));
});

test.each([ReceiverType.ExtendedQuery, ReceiverType.SimpleQuery] as const)(
  "写队列为空而读队列队尾不是 Sync 时拒绝开启事务，receiver=%s",
  (type) => {
    const t = new MessageTest();
    t.readQueue.enqueue(new QueryResultParser(vi.fn(), vi.fn(), statement, type));
    expect(() => t.writeQueue.beginTransaction()).toThrow(/read queue must end with Sync/);
    expect(t.messageTypes).toEqual([]);
  },
);

test.each([Status.Transaction, Status.Failed])("读写队列均为空但事务未结束时拒绝开启事务，status=%s", (status) => {
  const t = new MessageTest();
  t.readQueue.enqueueSync();
  t.readyForQuery(status);
  expect(t.readQueue.head).toBeUndefined();
  expect(() => t.writeQueue.beginTransaction()).toThrow(/already in a transaction/);
  expect(t.messageTypes).toEqual([]);
});

test("简单查询仅由自身 ReadyForQuery 解除屏障，前序 Sync 和多个完成消息不能解除", async () => {
  const t = new MessageTest();
  const first = observe(t.writeQueue.extendedQuery(statement));
  const simple = observe(t.writeQueue.simpleQuery(createTypeSqlStatementEncoder("SELECT 1; SELECT 2")));
  t.writeQueue.extendedQuery(statement);
  const blocked = [...pullExtended, F.Query];
  await vi.waitFor(() => expect(t.messageTypes).toEqual(blocked));
  expect(t.writeQueue.hasPending).toBe(true);
  t.commandComplete();
  t.readyForQuery();
  await first.promise;
  expect(t.messageTypes).toEqual(blocked);
  t.commandComplete();
  t.mockRead(B.ParameterStatus, "application_name\0queue-test\0");
  t.commandComplete(2);
  await Promise.resolve();
  expect(simple.result).not.toHaveBeenCalled();
  expect(t.readQueue.parameters.application_name).toBe("queue-test");
  expect(t.messageTypes).toEqual(blocked);
  const free = t.onWriteFree();
  t.readyForQuery();
  expect((await simple.promise).rowCount).toBe(2);
  expect(await free).toEqual([...blocked, ...pullExtended]);
  expect(t.writeQueue.hasPending).toBe(false);
});

//TODO: 需要确定连续的简单查询是否要逐个等待 ReadyForQuery
test("连续简单查询逐个等待 ReadyForQuery，空简单查询同样保持屏障", async () => {
  const t = new MessageTest();
  const first = observe(t.writeQueue.simpleQuery(createTypeSqlStatementEncoder("")));
  const second = observe(t.writeQueue.simpleQuery(statement));
  await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query]));
  t.mockRead(B.EmptyQueryResponse);
  await Promise.resolve();
  expect(first.result).not.toHaveBeenCalled();
  expect(t.messageTypes).toEqual([F.Query]);
  t.readyForQuery();
  await first.promise;
  await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query, F.Query]));
  const free = t.onWriteFree();
  t.commandComplete();
  t.readyForQuery();
  await second.promise;
  expect(await free).toEqual([F.Query, F.Query]);
  expect(t.readQueue.head).toBeUndefined();
});

test("事务内简单查询拒绝且不写入 Query，事务结束后的简单查询可以执行", async () => {
  const t = new MessageTest();
  t.writeQueue.beginTransaction();
  const invalid = observe(t.writeQueue.simpleQuery(statement));
  const valid = observe(t.writeQueue.extendedQuery(statement));
  t.writeQueue.endTransaction();
  const simple = observe(t.writeQueue.simpleQuery(statement));
  await expect(invalid.promise).rejects.toThrow(/transaction/i);
  const expected = [F.Execute, ...extended, F.Execute, F.Sync, F.Query];
  await vi.waitFor(() => expect(t.messageTypes).toEqual(expected));
  t.commandComplete("BEGIN");
  t.commandComplete();
  await valid.promise;
  t.commandComplete("COMMIT");
  t.readyForQuery();
  expect(t.messageTypes).toEqual(expected);
  const free = t.onWriteFree();
  t.commandComplete();
  t.readyForQuery();
  await simple.promise;
  expect(await free).toEqual(expected);
});

test.each(["extended", "simple"] as const)("RowDescription 和 DataRow 不使 %s 接收器提前出队", async (kind) => {
  const t = new MessageTest();
  const queryStatement = createTypeSqlStatementEncoder<{ value: string }>("SELECT 1");
  queryStatement.columnDecoders = new Map([[0, {
    decodeText: (value: string) => value,
    decodeBinary: (value: Uint8Array) => decoder.decode(value),
  }]]);
  const query = observe(
    kind === "extended" ? t.writeQueue.extendedQuery(queryStatement) : t.writeQueue.simpleQuery(queryStatement),
  );
  if (kind === "extended") expect(await t.onWriteFree()).toEqual([...extended, F.Sync]);
  else await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query]));
  const receiver = t.readQueue.head;
  const description = new Uint8Array(2 + 6 + 18);
  const view = new DataView(description.buffer);
  view.setUint16(0, 1);
  description.set(encoder.encode("value\0"), 2);
  view.setUint32(14, 25);
  view.setInt16(18, -1);
  view.setInt32(20, -1);
  t.mockRead(B.RowDescription, description);
  expect(t.readQueue.head).toBe(receiver);
  t.mockRead(B.DataRow, Uint8Array.of(0, 1, 0, 0, 0, 1, 49));
  expect(t.readQueue.head).toBe(receiver);
  t.commandComplete();
  t.readyForQuery();
  const result = await query.promise;
  expect(result.rows).toEqual([{ value: "1" }]);
  expect(result.fields?.[0].name).toBe("value");
  expect(t.readQueue.head).toBeUndefined();
});

test("空扩展查询终结当前接收器，不吞掉下一条查询", async () => {
  const t = new MessageTest();
  const empty = observe(t.writeQueue.extendedQuery(createTypeSqlStatementEncoder("")));
  const next = observe(t.writeQueue.extendedQuery(statement));
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync, ...extended, F.Sync]);
  t.mockRead(B.NoData);
  t.mockRead(B.EmptyQueryResponse);
  t.readyForQuery();
  expect((await empty.promise).rows).toEqual([]);
  t.commandComplete(2);
  t.readyForQuery();
  expect((await next.promise).rowCount).toBe(2);
});

test("独立同步段失败不会拒绝下一条已流水线发送的查询", async () => {
  const t = new MessageTest();
  const first = observe(t.writeQueue.extendedQuery(statement));
  const next = observe(t.writeQueue.extendedQuery(statement));
  await expect(t.onWriteFree()).resolves.toEqual([...extended, F.Sync, ...extended, F.Sync]);
  t.errorResponse();
  await expect(first.promise).rejects.toBeInstanceOf(PgDatabaseError);
  t.readyForQuery();
  expect(next.result).not.toHaveBeenCalled();
  t.commandComplete(2);
  t.readyForQuery();
  expect((await next.promise).rowCount).toBe(2);
});

test("事务外查询完成后仍等待 Sync，隐式提交失败拒绝当前段而不影响下一段", async () => {
  const t = new MessageTest();
  const first = observe(t.writeQueue.extendedQuery(statement));
  const next = observe(t.writeQueue.extendedQuery(statement));
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync, ...extended, F.Sync]);
  t.commandComplete();
  await Promise.resolve();
  expect(first.result).not.toHaveBeenCalled();
  t.errorResponse("deferred constraint failed");
  await expect(first.promise).rejects.toThrow("deferred constraint failed");
  t.readyForQuery();
  t.commandComplete(2);
  t.readyForQuery();
  expect((await next.promise).rowCount).toBe(2);
});

test("事务段失败拒绝被跳过的查询与结束命令，不跨越 Sync 或自动回滚", async () => {
  const t = new MessageTest();
  t.writeQueue.beginTransaction();
  const first = observe(t.writeQueue.extendedQuery(statement));
  const skipped = observe(t.writeQueue.extendedQuery(statement));
  t.writeQueue.endTransaction();
  const next = observe(t.writeQueue.extendedQuery(statement));
  const expected = [F.Execute, ...extended, ...extended, F.Execute, F.Sync, ...extended, F.Sync];
  expect(await t.onWriteFree()).toEqual(expected);
  t.commandComplete("BEGIN");
  t.errorResponse();
  await expect(first.promise).rejects.toBeInstanceOf(PgDatabaseError);
  await expect(skipped.promise).rejects.toBeInstanceOf(PgDatabaseError);
  t.readyForQuery(Status.Failed);
  expect(t.readQueue.transactionStatus).toBe(Status.Failed);
  expect(next.result).not.toHaveBeenCalled();
  t.errorResponse("current transaction is aborted");
  t.readyForQuery(Status.Failed);
  await expect(next.promise).rejects.toThrow("current transaction is aborted");
  expect(t.messageTypes).toEqual(expected);
  expect(t.readQueue.head).toBeUndefined();
});

test("事务错误早于 END 入队时，后续事务任务被跳过直到 Sync", async () => {
  const t = new MessageTest();
  t.writeQueue.beginTransaction();
  const first = observe(t.writeQueue.extendedQuery(statement));
  expect(await t.onWriteFree()).toEqual([F.Execute, ...extended]);
  expect(t.writeQueue.hasPending).toBe(false);
  t.commandComplete("BEGIN");
  t.errorResponse();
  await expect(first.promise).rejects.toBeInstanceOf(PgDatabaseError);
  const skipped = observe(t.writeQueue.extendedQuery(statement));
  t.writeQueue.endTransaction(true);
  expect(await t.onWriteFree()).toEqual([F.Execute, ...extended, ...extended, F.Execute, F.Sync]);
  await expect(skipped.promise).rejects.toBeInstanceOf(PgDatabaseError);
  t.readyForQuery(Status.Failed);
  expect(t.readQueue.transactionStatus).toBe(Status.Failed);
  expect(t.readQueue.head).toBeUndefined();
});

test("BEGIN 出错时跳过整个事务段，后面的独立段仍能收到自己的结果", async () => {
  const t = new MessageTest();
  t.writeQueue.beginTransaction();
  const skipped = observe(t.writeQueue.extendedQuery(statement));
  t.writeQueue.endTransaction();
  const next = observe(t.writeQueue.extendedQuery(statement));
  expect(await t.onWriteFree()).toEqual([F.Execute, ...extended, F.Execute, F.Sync, ...extended, F.Sync]);
  t.errorResponse("begin failed");
  await expect(skipped.promise).rejects.toThrow("begin failed");
  t.readyForQuery();
  t.commandComplete(2);
  t.readyForQuery();
  expect((await next.promise).rowCount).toBe(2);
});

test("简单查询 ErrorResponse 不解除屏障，Idle ReadyForQuery 后才能继续", async () => {
  const t = new MessageTest();
  const simple = observe(t.writeQueue.simpleQuery(statement));
  const next = observe(t.writeQueue.extendedQuery(statement));
  await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query]));
  t.errorResponse();
  await expect(simple.promise).rejects.toBeInstanceOf(PgDatabaseError);
  expect(t.messageTypes).toEqual([F.Query]);
  expect(t.writeQueue.hasPending).toBe(true);
  const free = t.onWriteFree();
  t.readyForQuery();
  expect(await free).toEqual([F.Query, ...extended, F.Sync]);
  t.commandComplete();
  t.readyForQuery();
  await next.promise;
  expect(t.writeQueue.hasPending).toBe(false);
});

test.each([Status.Transaction, Status.Failed])("简单查询返回非 Idle 状态 %s 时停止队列且不自动回滚", async (status) => {
  const t = new MessageTest();
  const simple = catchPromise(t.writeQueue.simpleQuery(statement));
  const next = catchPromise(t.writeQueue.extendedQuery(statement));
  await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query]));
  t.commandComplete();
  t.readyForQuery(status);
  await expect(simple).rejects.toBeInstanceOf(PgProtocolError);
  await expect(next).rejects.toBeInstanceOf(PgProtocolError);
  await drained(t);
  await expect(t.writeQueue.extendedQuery(statement)).rejects.toBeInstanceOf(PgProtocolError);
  expect(() => t.writeQueue.beginTransaction()).toThrow(PgProtocolError);
  expect(t.messageTypes).toEqual([F.Query]);
  expect(t.readQueue.transactionStatus).toBe(status);
  expect(t.readQueue.head).toBeUndefined();
});

test("连接失败拒绝简单查询等待者与尚未发送的任务", async () => {
  const t = new MessageTest();
  const simple = observe(t.writeQueue.simpleQuery(statement));
  const next = observe(t.writeQueue.extendedQuery(statement));
  await vi.waitFor(() => expect(t.messageTypes).toEqual([F.Query]));
  const error = new Error("connection closed");
  t.readQueue.fail(error);
  t.writeQueue.fail(error);
  await expect(simple.promise).rejects.toBe(error);
  await expect(next.promise).rejects.toBe(error);
  await drained(t);
  expect(t.readQueue.head).toBeUndefined();
  expect(t.messageTypes).toEqual([F.Query]);
  await expect(t.writeQueue.simpleQuery(statement)).rejects.toBe(error);
});

test("底层写入失败拒绝已登记和未发送的查询，不发出成功排空通知", async () => {
  const t = new MessageTest();
  const onFree = vi.fn();
  t.on("writeFree", onFree);
  const error = new Error("write failed");
  t.writeError = error;
  const first = observe(t.writeQueue.extendedQuery(statement));
  const next = observe(t.writeQueue.extendedQuery(statement));
  await expect(first.promise).rejects.toBe(error);
  await expect(next.promise).rejects.toBe(error);
  await drained(t);
  expect(t.readQueue.head).toBeUndefined();
  expect(onFree).not.toHaveBeenCalled();
});

test("连接失败也拒绝已 CommandComplete 但尚未 ReadyForQuery 的查询", async () => {
  const t = new MessageTest();
  const query = observe(t.writeQueue.extendedQuery(statement));
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync]);
  t.commandComplete();
  const error = new Error("connection closed before commit");
  t.readQueue.fail(error);
  t.writeQueue.fail(error);
  await expect(query.promise).rejects.toBe(error);
  expect(t.readQueue.head).toBeUndefined();
});

test("writeFree 回调中新入队的查询会启动新一轮写入", async () => {
  const t = new MessageTest();
  const onFree = vi.fn();
  t.on("writeFree", () => {
    onFree();
    if (onFree.mock.calls.length === 1) void t.writeQueue.extendedQuery(statement);
  });
  void t.writeQueue.extendedQuery(statement);
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync]);
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync, ...extended, F.Sync]);
  expect(onFree).toHaveBeenCalledTimes(2);
});

test.each([1, 2, 5])("底层每次最多写入 %s 字节时，前端帧仍保持完整和正确顺序", async (maxWrite) => {
  const t = new MessageTest({ maxWrite });
  void t.writeQueue.extendedQuery(statement);
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync]);
  expect(t.hasIncompleteFrame).toBe(false);
});

test("MessageTest 的 onWriteFree 将完整扩展查询压缩为 Execute 并保留 Sync", async () => {
  const t = new MessageTest({ maxWrite: 2 });
  const free = t.onWriteFree();
  void t.writeQueue.extendedQuery(statement);
  void t.writeQueue.extendedQuery(statement);
  expect(await free).toEqual([F.Execute, F.Flush, F.Sync, F.Execute, F.Flush, F.Sync]);
  expect(t.hasIncompleteFrame).toBe(false);
});

test("读队列直接入队的扩展接收器在 PortalSuspended 时完成", async () => {
  const t = new MessageTest();
  const resolve = vi.fn();
  const reject = vi.fn();
  const parser = new QueryResultParser(resolve, reject, statement);
  t.readQueue.enqueue(parser);
  t.mockRead(B.PortalSuspended);
  expect(resolve).toHaveBeenCalledWith(parser);
  expect(reject).not.toHaveBeenCalled();
  expect(t.readQueue.head).toBeUndefined();
});

test.each([B.CommandComplete, B.RowDescription, B.ReadyForQuery])("无接收器的响应 %s 显式报告协议错误", (code) => {
  const t = new MessageTest();
  expect(() => t.mockRead(code, code === B.ReadyForQuery ? Uint8Array.of(Status.Idle) : new Uint8Array(0)))
    .toThrow(PgProtocolError);
  expect(t.readQueue.error).toBeUndefined();
});

test("错位 ReadyForQuery 的监听器异常交给上层处理，再由 fail 拒绝查询", async () => {
  const t = new MessageTest();
  const query = observe(t.writeQueue.extendedQuery(statement));
  expect(await t.onWriteFree()).toEqual([...extended, F.Sync]);
  expect(() => t.readyForQuery()).toThrow(PgProtocolError);
  expect(t.readQueue.error).toBeUndefined();
  expect(query.result).not.toHaveBeenCalled();
  const error = new PgProtocolError("connection parser failed");
  t.readQueue.fail(error);
  t.writeQueue.fail(error);
  await expect(query.promise).rejects.toBe(error);
  expect(t.readQueue.head).toBeUndefined();
});

test("fail 拒绝直接登记的结果接收器并清空继承链表", () => {
  const t = new MessageTest();
  const reject = vi.fn();
  t.readQueue.enqueue(new QueryResultParser(vi.fn(), reject, statement));
  t.readQueue.enqueue({ type: ReceiverType.Sync });
  const error = new Error("closed");
  t.readQueue.fail(error);
  t.writeQueue.fail(error);
  expect(reject).toHaveBeenCalledWith(error);
  expect([...t.readQueue]).toEqual([]);
});
