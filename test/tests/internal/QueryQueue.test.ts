import { expect, test } from "vitest";
import { MessageTest } from "@test/mock/MessageTypeParser.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { BackendMessageCode, FrontendMessageCode, PgTransactionStatus } from "@/protocol/const.ts";

const mockQueryStatement = createTypeSqlStatementEncoder("SELECT 1");

test("扩展查询连续发送，每个扩展查询都应跟着 Sync", async () => {
  const messageTest = new MessageTest();
  const queue = messageTest.writeQueue;
  const q1 = queue.extendedQuery(mockQueryStatement);
  const q2 = queue.extendedQuery(mockQueryStatement);
  const q3 = queue.extendedQuery(mockQueryStatement);
  const sent = await messageTest.onWriteFree();

  expect(sent).toEqual([
    FrontendMessageCode.Execute,
    FrontendMessageCode.Flush,
    FrontendMessageCode.Sync,
    FrontendMessageCode.Execute,
    FrontendMessageCode.Flush,
    FrontendMessageCode.Sync,
    FrontendMessageCode.Execute,
    FrontendMessageCode.Flush,
    FrontendMessageCode.Sync,
  ]);
});

test("简单查询阻止后续扩展查询发送，直到 ReadyForQuery", async () => {
  const messageTest = new MessageTest();
  const queue = messageTest.writeQueue;
  const first = queue.extendedQuery(mockQueryStatement);
  const simple = queue.simpleQuery(mockQueryStatement);
  const last = queue.extendedQuery(mockQueryStatement);

  const sent = await messageTest.onWriteFree();
  expect(sent.at(-1)).toBe(FrontendMessageCode.Query);
  messageTest.mockRead(BackendMessageCode.NoData);
  messageTest.commandComplete(1);
  messageTest.readyForQuery(PgTransactionStatus.Idle);
  await first;
  expect(sent.at(-1)).toBe(FrontendMessageCode.Query);
  messageTest.commandComplete(1);
  messageTest.commandComplete(1);
  expect(sent.at(-1)).toBe(FrontendMessageCode.Query);
  messageTest.commandComplete(1);

  expect(sent.at(-1)).toBe(FrontendMessageCode.Sync);
  messageTest.mockRead(BackendMessageCode.NoData);
  messageTest.commandComplete(1);
  messageTest.readyForQuery(PgTransactionStatus.Idle);
  await last;
});

test("进入事务后的扩展查询，无需带上 Sync", async () => {
  const messageTest = new MessageTest();
  const queue = messageTest.writeQueue;
});

test("独立同步段失败后，下一条已流水线发送的查询继续执行", async () => {
});
