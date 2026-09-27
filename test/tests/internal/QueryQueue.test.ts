import { expect, test } from "vitest";
import { BufferReader } from "@/_utils/StreamReader.ts";
import type { StreamWriter } from "@/_utils/StreamWriter.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { BackendMessageCode, FrontendMessageCode, PgTransactionStatus } from "@/protocol/const.ts";
import { MessageParsers } from "@/protocol/parsers/MessageParser.ts";
import { QueryResultQueue } from "@/protocol/QueryQueue.ts";

function createQueue() {
  const sent: number[] = [];
  const parsers = new MessageParsers(1024);
  const writer: StreamWriter = {
    pushData: (data) => sent.push(data[0]),
    pushWrite: () => {},
    pushWriteInto: () => {},
  };
  const queue = new QueryResultQueue(parsers, writer);
  const receive = (code: BackendMessageCode, body: Uint8Array = new Uint8Array()) => {
    const frame = new Uint8Array(5 + body.byteLength);
    frame[0] = code;
    new DataView(frame.buffer).setUint32(1, 4 + body.byteLength);
    frame.set(body, 5);
    parsers.next(new BufferReader(frame, frame.byteLength));
  };
  return { queue, receive, sent };
}

test("独立扩展查询连续发送，每个查询在自身 ReadyForQuery 后完成", async () => {
  const { queue, receive, sent } = createQueue();
  const first = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 1"));
  const second = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 2"));
  expect(sent).toEqual([
    FrontendMessageCode.Parse,
    FrontendMessageCode.Bind,
    FrontendMessageCode.Describe,
    FrontendMessageCode.Execute,
    FrontendMessageCode.Sync,
    FrontendMessageCode.Parse,
    FrontendMessageCode.Bind,
    FrontendMessageCode.Describe,
    FrontendMessageCode.Execute,
    FrontendMessageCode.Sync,
  ]);
  let completed = false;
  void first.then(() => completed = true);
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  await Promise.resolve();
  expect(completed).toBe(false);
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  expect((await first).rowCount).toBe(1);
  expect(completed).toBe(true);
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  expect((await second).rowCount).toBe(1);
});

test("简单查询阻止后续扩展查询发送，直到 ReadyForQuery", async () => {
  const { queue, receive, sent } = createQueue();
  const first = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 1"));
  const simple = queue.simpleQuery(createTypeSqlStatementEncoder("SELECT 2; SELECT 3"));
  const last = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 4"));
  expect(sent.at(-1)).toBe(FrontendMessageCode.Query);
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  await first;
  expect(sent.at(-1)).toBe(FrontendMessageCode.Query);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  expect(sent.at(-1)).toBe(FrontendMessageCode.Query);
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  expect((await simple).map((result) => result.rowCount)).toEqual([1, 1]);
  expect(sent.at(-1)).toBe(FrontendMessageCode.Sync);
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  await last;
});

test("事务扩展查询使用 Flush，结束命令后由显式 Sync 确认", async () => {
  const { queue, receive, sent } = createQueue();
  const begin = queue.beginTransaction();
  expect(sent).toEqual([
    FrontendMessageCode.Parse,
    FrontendMessageCode.Bind,
    FrontendMessageCode.Describe,
    FrontendMessageCode.Execute,
    FrontendMessageCode.Flush,
  ]);
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("BEGIN\0"));
  await begin;
  const query = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 1"), false);
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  await query;
  const end = queue.extendedQuery(createTypeSqlStatementEncoder("COMMIT"), false);
  const synced = queue.synchronize();
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("COMMIT\0"));
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  await end;
  expect(await synced).toBe(PgTransactionStatus.Idle);
  expect(sent.slice(-2)).toEqual([FrontendMessageCode.Flush, FrontendMessageCode.Sync]);
});

test("独立同步段失败后，下一条已流水线发送的查询继续执行", async () => {
  const { queue, receive } = createQueue();
  const first = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 1 / 0"));
  const second = queue.extendedQuery(createTypeSqlStatementEncoder("SELECT 2"));
  let rejected = false;
  void first.catch(() => rejected = true);
  receive(BackendMessageCode.ErrorResponse, new TextEncoder().encode("SERROR\0C22012\0Mdivision by zero\0\0"));
  await Promise.resolve();
  expect(rejected).toBe(false);
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  await expect(first).rejects.toThrow("division by zero");
  receive(BackendMessageCode.NoData);
  receive(BackendMessageCode.CommandComplete, new TextEncoder().encode("SELECT 1\0"));
  receive(BackendMessageCode.ReadyForQuery, Uint8Array.of(PgTransactionStatus.Idle));
  expect((await second).rowCount).toBe(1);
});
