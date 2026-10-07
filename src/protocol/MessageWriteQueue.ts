import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import {
  BeginTransactionTask,
  ExtendedQueryTask,
  QueryAction,
  QueryTask,
  SimpleQueryTask,
} from "./parsers/QueryTask.ts";
import { QueryResultParser, SampleQueryResultParser } from "./parsers/QueryResultParser.ts";
import {
  DescribeTarget,
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
} from "./encode.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";

export class QueryWriteQueue {
  constructor(
    private readonly writer: BufferShortWriter,
    private readQueue: QueryReadQueue,
    private readonly onWriteEmpty: () => void,
  ) {
  }

  private writeQueue = new LinkList<QueryTask>();

  private writing?: Promise<unknown>;
  /** 写队列是否有待处理的任务 */
  get hasPending(): boolean {
    return !!this.writing;
  }

  simpleQuery(statement: TypedSqlStatementEncoder): Promise<SampleQueryResultParser> {
    return new Promise((resolve, reject) => {
      this.writeQueue.enqueue({ type: QueryAction.SimpleQuery, statement, resolve, reject });
      this.handleWrite();
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
    this.enqueueWriteQueue({ type: QueryAction.Begin, mode });
  }
  endTransaction(rollback = false): void {
    this.enqueueWriteQueue({ type: rollback ? QueryAction.Rollback : QueryAction.Commit });
  }
  private enqueueWriteQueue(item: QueryTask) {
    this.writeQueue.enqueue(item);
    if (this.writing) return;

    this.writing = this.handleWrite()
      .then(this.onWriteEmpty, (err) => {
        this.readQueue.fail(err);
      }).finally(() => {
        this.writing = undefined;
      });
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
  }
  private async writeSimpleQueryTask(item: SimpleQueryTask): Promise<void> {
    //TODO
    throw new Error("writeSimpleQueryTask is not implemented");
  }
  private async writeExtendedQueryTask(item: ExtendedQueryTask): Promise<void> {
    const parser = new QueryResultParser(item.resolve, item.reject, item.statement);
    this.readQueue.enqueue(parser);
    await writeExtendQuery(this.writer, item.statement);
    await this.writer.writeData(FRAME.FLUSH);
  }
  private writeBeginTransactionTask(item: BeginTransactionTask): Promise<void> {
    const statement = createTypeSqlStatementEncoder("BEGIN" + (item.mode ? " " + item.mode : ""));
    return writeExtendQuery(this.writer, statement);
  }
  private writeEndTransactionTask(type: "COMMIT" | "ROLLBACK"): Promise<void> {
    const statement = createTypeSqlStatementEncoder(type);
    return writeExtendQuery(this.writer, statement);
  }
}

async function writeExtendQuery(writer: BufferShortWriter, statement: TypedSqlStatementEncoder) {
  await writer.writeData(encodeParseMessage(statement));
  await writer.writeData(encodeBindMessage(statement));
  await writer.writeData(encodeDescribeMessage(DescribeTarget.Portal));
  await writer.writeData(encodeExecuteMessage(0));
}
