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
  encodeTerminateMessage,
} from "./encode.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";
import { InternalError, SessionClosedError } from "@/_utils/error.ts";
import console from "node:console";

export class QueryWriteQueue {
  constructor(
    private readonly writer: BufferShortWriter,
    private readonly readQueue: QueryReadQueue,
    private readonly onWriteEmpty: () => void,
  ) {
  }
  rejectQueue(error: Error) {
    for (const item of this.writeQueue) {
      if (item.type === QueryAction.ExtendedQuery || item.type === QueryAction.SimpleQuery) item.reject(error);
    }
    this.writeQueue.clear();
  }
  private writeQueue = new LinkList<QueryTask>();

  private closePromise?: PromiseWithResolvers<void>;
  get closed(): boolean {
    return !!this.closePromise;
  }
  setClosed() {
    if (!this.closePromise) this.closePromise = Promise.withResolvers<void>();
    this.closePromise.resolve();
  }

  private writing?: Promise<unknown>;
  /** 写队列是否有待处理的任务 */
  get hasPending(): boolean {
    return !!this.writing || !!this.writeQueue.head;
  }
  extendedQuery<T>(statement: TypedSqlStatementEncoder): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      this.enqueueWrite({
        type: QueryAction.ExtendedQuery,
        statement,
        resolve: resolve as (value: QueryResultParser) => void,
        reject,
      });
    });
  }
  sync(): void {
    this.enqueueWrite({ type: QueryAction.Sync });
  }
  simpleQuery(statement: TypedSqlStatementEncoder): Promise<SampleQueryResultParser> {
    return new Promise((resolve, reject) => {
      this.enqueueWrite({ type: QueryAction.SimpleQuery, statement, resolve, reject });
    });
  }
  beginTransaction(mode?: TransactionMode): void {
    this.enqueueWrite({ type: QueryAction.Begin, mode });
  }
  commitTransaction(): void {
    this.enqueueWrite({ type: QueryAction.Commit });
  }
  rollbackTransaction(): void {
    this.enqueueWrite({ type: QueryAction.Rollback });
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = Promise.withResolvers<void>();
    }
    if (this.hasPending) {
      this.writeQueue.enqueue({ type: QueryAction.Close });
    } else {
      this.writeQueue.enqueue({ type: QueryAction.Close });
      this.startWrite();
    }
    return this.closePromise.promise;
  }

  private enqueueWrite(item: QueryTask) {
    if (this.closed) {
      if (item.type === QueryAction.ExtendedQuery || item.type === QueryAction.SimpleQuery) {
        item.reject(new SessionClosedError());
      }
      return;
    }
    this.writeQueue.enqueue(item);
  }

  checkWriteQueue(): void {
    if (this.writing) return;
    if (!this.writeQueue.head) return;
    this.startWrite();
  }
  private startWrite() {
    this.writing = this.handleWrite().then(
      () => {
        this.writing = undefined;
        if (this.writeQueue.head) return this.checkWriteQueue();
        this.onWriteEmpty();
      },
      (cause) => {
        const error = cause instanceof Error ? cause : new Error("PostgreSQL query write failed", { cause });
        this.readQueue.fail(error);
        this.writing = undefined;
        //TODO: 通知 PgSession 写入失败
      },
    );
  }

  private async handleWrite() {
    const { writeQueue } = this;
    let item = writeQueue.head;
    while (item) {
      switch (item.type) {
        case QueryAction.ExtendedQuery: {
          await this.writeExtendedQueryTask(item);
          break;
        }
        case QueryAction.Sync:
          await this.writeSync();
          break;
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
        case QueryAction.Close:
          await this.writer.writeData(encodeTerminateMessage());
          await this.writer.flush(0);
          writeQueue.dequeue();

          if (this.writeQueue.head) {
            console.error(new InternalError("Write queue is not empty after sending terminate message"));
            this.rejectQueue(new SessionClosedError());
          }
          return;
      }
      writeQueue.dequeue();
      item = writeQueue.head;
    }
    await this.writer.flush(0);
  }
  private async writeExtendedQueryTask(item: ExtendedQueryTask): Promise<void> {
    const parser = new QueryResultParser(item.resolve, item.reject, item.statement);
    this.readQueue.enqueue(parser);
    await this.writeExtended(item.statement);
    await this.writer.writeData(FRAME.FLUSH);
  }
  private async writeSync(): Promise<void> {
    this.readQueue.enqueueSync();
    await this.writer.writeData(FRAME.SYNC);
  }
  private async writeSimpleQueryTask(item: SimpleQueryTask): Promise<void> {
    const message = encodeQueryMessage({
      calculateByteLength: () => item.statement.calculateQueryByteLength(),
      encodeQueryInto: (buffer, offset) => item.statement.encodeQueryInto(buffer, offset),
    });

    const parser = new SampleQueryResultParser(() => item.resolve(parser), item.reject, item.statement);
    const ready = this.readQueue.enqueueSimpleQuery(parser);
    await this.writer.writeData(message);
    return ready;
  }

  private async writeBeginTransactionTask(item: BeginTransactionTask): Promise<void> {
    const statement = createTypeSqlStatementEncoder("BEGIN" + (item.mode ? " ISOLATION LEVEL " + item.mode : ""));
    this.readQueue.enqueue({ type: ReceiverType.StartTransaction });
    await this.writeExtended(statement);
  }
  private async writeEndTransactionTask(type: "COMMIT" | "ROLLBACK"): Promise<void> {
    const statement = createTypeSqlStatementEncoder(type);
    this.readQueue.enqueue({ type: ReceiverType.EndTransaction });
    this.readQueue.enqueueSync();
    await this.writeExtended(statement);
  }

  private async writeExtended(statement: TypedSqlStatementEncoder): Promise<void> {
    await this.writer.writeData(encodeParseMessage(statement));
    await this.writer.writeData(encodeBindMessage(statement));
    await this.writer.writeData(encodeDescribeMessage(DescribeTarget.Portal));
    await this.writer.writeData(encodeExecuteMessage(0));
  }
}
