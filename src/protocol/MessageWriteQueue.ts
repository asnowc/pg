import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import {
  BeginTransactionTask,
  ExtendedQueryTask,
  QueryAction,
  QueryTask,
  ReceiverType,
  SimpleQueryTask,
} from "./parsers/QueryTask.ts";
import { QueryResultParser, SampleQueryResultParser } from "./parsers/QueryResultParser.ts";
import {
  DescribeTarget,
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
  encodeQueryMessage,
} from "./encode.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { PgTransactionStatus } from "./const.ts";

export class QueryWriteQueue {
  constructor(
    private readonly writer: BufferShortWriter,
    private readonly readQueue: QueryReadQueue,
    private readonly onWriteEmpty: () => void,
  ) {
  }
  fail(error: Error) {
    for (const item of this.writeQueue) {
      if (item.type === QueryAction.ExtendedQuery || item.type === QueryAction.SimpleQuery) item.reject(error);
    }
    this.writeQueue.clear();
  }
  private writeQueue = new LinkList<QueryTask>();

  private transactionQueued = false;
  private inTransaction = false;
  private unsyncedExtended = false;

  private writing?: Promise<unknown>;
  /** 写队列是否有待处理的任务 */
  get hasPending(): boolean {
    return !!this.writing || !!this.writeQueue.head;
  }

  simpleQuery(statement: TypedSqlStatementEncoder): Promise<SampleQueryResultParser> {
    return new Promise((resolve, reject) => {
      if (this.transactionQueued) {
        reject(new PgProtocolError("Simple queries are not allowed inside a transaction"));
        return;
      }
      this.enqueueWriteQueue({ type: QueryAction.SimpleQuery, statement, resolve, reject });
    });
  }

  extendedQuery<T>(
    statement: TypedSqlStatementEncoder,
  ): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      this.enqueueWriteQueue({
        type: QueryAction.ExtendedQuery,
        statement,
        resolve: resolve as (value: QueryResultParser) => void,
        reject,
      });
    });
  }
  beginTransaction(mode?: TransactionMode): void {
    if (this.readQueue.error) throw this.readQueue.error;
    if (this.transactionQueued) throw new PgProtocolError("A transaction is already queued");
    this.assertTransactionBoundary();
    this.transactionQueued = true;
    this.enqueueWriteQueue({ type: QueryAction.Begin, mode });
  }
  endTransaction(rollback = false): void {
    if (this.readQueue.error) throw this.readQueue.error;
    if (!this.transactionQueued) throw new PgProtocolError("No transaction is queued");
    this.transactionQueued = false;
    this.enqueueWriteQueue({ type: rollback ? QueryAction.Rollback : QueryAction.Commit });
  }
  private assertTransactionBoundary(): void {
    const pending = getQueueTail(this.writeQueue);
    if (pending) {
      // Outside a queued transaction, these tasks include their trailing Sync.
      if (
        pending.type !== QueryAction.ExtendedQuery && pending.type !== QueryAction.Commit &&
        pending.type !== QueryAction.Rollback
      ) {
        throw new PgProtocolError("Cannot begin transaction: write queue must end with Sync");
      }
      return;
    }
    const receiver = getQueueTail(this.readQueue);
    if (receiver) {
      if (receiver.type !== ReceiverType.Sync) {
        throw new PgProtocolError("Cannot begin transaction: read queue must end with Sync");
      }
    } else if (this.inTransaction || this.readQueue.transactionStatus !== PgTransactionStatus.Idle) {
      throw new PgProtocolError("Cannot begin transaction: connection is already in a transaction");
    }
  }
  private enqueueWriteQueue(item: QueryTask) {
    if (this.readQueue.error) {
      if (item.type === QueryAction.ExtendedQuery || item.type === QueryAction.SimpleQuery) {
        item.reject(this.readQueue.error);
      }
      return;
    }
    this.writeQueue.enqueue(item);
    this.startWriting();
  }
  private startWriting(): void {
    if (this.writing || !this.writeQueue.head || this.readQueue.error) return;
    this.writing = this.handleWrite().then(
      () => {
        this.writing = undefined;
        if (this.readQueue.error) return;
        if (this.writeQueue.head) this.startWriting();
        else this.onWriteEmpty();
      },
      (cause) => {
        const error = cause instanceof Error ? cause : new Error("PostgreSQL query write failed", { cause });
        this.readQueue.fail(error);
        this.writing = undefined;
      },
    );
  }
  private async handleWrite() {
    const { writeQueue } = this;
    let item = writeQueue.head;
    while (item) {
      if (this.readQueue.error) throw this.readQueue.error;
      switch (item.type) {
        case QueryAction.ExtendedQuery: {
          await this.writeExtendedQueryTask(item);
          break;
        }
        case QueryAction.SimpleQuery: {
          await this.writeSimpleQueryTask(item);
          break;
        }
        case QueryAction.Begin:
          await this.writeBeginTransactionTask(item);
          break;
        case QueryAction.Commit:
          await this.writeEndTransactionTask(item.type);
          break;
        case QueryAction.Rollback:
          await this.writeEndTransactionTask(item.type);
          break;
      }
      writeQueue.dequeue();
      item = writeQueue.head;
    }
    await this.flushWriter();
  }
  private async writeSimpleQueryTask(item: SimpleQueryTask): Promise<void> {
    if (this.inTransaction) throw new Error("Simple queries are not allowed inside a transaction");
    if (this.unsyncedExtended) await this.writeSync();
    const message = encodeQueryMessage({
      calculateByteLength: () => item.statement.calculateQueryByteLength(),
      encodeQueryInto: (buffer, offset) => item.statement.encodeQueryInto(buffer, offset),
    });

    const parser = new SampleQueryResultParser(() => item.resolve(parser), item.reject, item.statement);
    const ready = this.readQueue.enqueueSimpleQuery(parser);
    await Promise.all([
      this.writer.writeData(message).then(() => this.flushWriter()),
      ready,
    ]);
  }
  private async writeExtendedQueryTask(item: ExtendedQueryTask): Promise<void> {
    const parser = new QueryResultParser(item.resolve, item.reject, item.statement);
    this.readQueue.enqueue(parser);
    // Register the boundary before writing: responses may arrive during a transport write.
    if (!this.inTransaction) this.readQueue.enqueueSync(parser);
    await this.writeExtended(item.statement);
    await this.writer.writeData(FRAME.FLUSH);
    if (!this.inTransaction) {
      await this.writer.writeData(FRAME.SYNC);
      this.unsyncedExtended = false;
    }
  }
  private async writeBeginTransactionTask(item: BeginTransactionTask): Promise<void> {
    const statement = createTypeSqlStatementEncoder("BEGIN" + (item.mode ? " ISOLATION LEVEL " + item.mode : ""));
    this.readQueue.enqueue({ type: ReceiverType.StartTransaction });
    this.inTransaction = true;
    await this.writeExtended(statement);
  }
  private async writeEndTransactionTask(type: "COMMIT" | "ROLLBACK"): Promise<void> {
    const statement = createTypeSqlStatementEncoder(type);
    this.readQueue.enqueue({ type: ReceiverType.EndTransaction });
    this.readQueue.enqueueSync();
    await this.writeExtended(statement);
    await this.writer.writeData(FRAME.SYNC);
    this.inTransaction = false;
    this.unsyncedExtended = false;
  }
  private async writeSync(): Promise<void> {
    this.readQueue.enqueueSync();
    await this.writer.writeData(FRAME.SYNC);
    this.unsyncedExtended = false;
  }
  private async writeExtended(statement: TypedSqlStatementEncoder): Promise<void> {
    this.unsyncedExtended = true;
    await this.writer.writeData(encodeParseMessage(statement));
    await this.writer.writeData(encodeBindMessage(statement));
    await this.writer.writeData(encodeDescribeMessage(DescribeTarget.Portal));
    await this.writer.writeData(encodeExecuteMessage(0));
  }
  private async flushWriter(): Promise<void> {
    if (this.readQueue.error) throw this.readQueue.error;
    await this.writer.flush(0);
    if (this.readQueue.error) throw this.readQueue.error;
  }
}

function getQueueTail<T extends object>(queue: LinkList<T>): T | undefined {
  let tail: T | undefined;
  for (const item of queue) tail = item;
  return tail;
}
