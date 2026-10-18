import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { throwRewrittenError } from "@/_utils/error.ts";
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
import { BufferWriter, BufferWriterQueue } from "@/_utils/StreamWriter.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";

export class QueryWriteQueue extends BufferWriterQueue<QueryTask> {
  constructor(
    private writer: BufferWriter,
    private readonly readQueue: QueryReadQueue,
    private readonly onClose: () => Promise<void>,
    onWriteError: (cause: unknown) => void,
    onClear: () => void,
  ) {
    super(onWriteError, onClear);
  }
  protected override get writeOffset(): number {
    return this.writer.writeOffset;
  }
  protected override flush(): Promise<void> {
    return this.writer.flush();
  }
  override clear(error: Error = new Error("QueryWriteQueue cleared")): void {
    for (const item of this) {
      if (item.type === QueryAction.ExtendedQuery || item.type === QueryAction.SimpleQuery) {
        item.reject(error);
      }
    }
    super.clear();
  }
  extendedQuery<T>(statement: TypedSqlStatementEncoder): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      this.push({
        type: QueryAction.ExtendedQuery,
        statement,
        resolve: resolve as (value: QueryResultParser) => void,
        reject,
      });
    }).catch((e) => throwRewrittenError(e));
  }
  sync(): void {
    this.push({ type: QueryAction.Sync });
  }
  clearWriteQueueForSync(): void {
    let item = this.queueHead;
    while (item) {
      if (item.type === QueryAction.Sync) return;
      this.shift();
      item = this.queueHead;
    }
    this.sync();
  }

  simpleQuery(statement: TypedSqlStatementEncoder): Promise<SampleQueryResultParser> {
    return new Promise((resolve, reject) => {
      this.push({ type: QueryAction.SimpleQuery, statement, resolve, reject });
    });
  }
  beginTransaction(mode?: TransactionMode): void {
    this.push({ type: QueryAction.Begin, mode });
  }
  commitTransaction(): void {
    this.push({ type: QueryAction.Commit });
  }
  rollbackTransaction(): void {
    this.push({ type: QueryAction.Rollback });
  }
  close() {
    return new Promise<void>((resolve, reject) => {
      this.push({ type: QueryAction.Close, resolve, reject });
    });
  }

  protected override async processItemWrite(item: QueryTask): Promise<void> {
    // 需要确保函数调用到  this.readQueue.enqueueSync() 是同步的
    // 否则 clearWriteQueueForSync 会情况当前正在处理的 SYNC 之后的任务
    while (item) {
      switch (item.type) {
        case QueryAction.ExtendedQuery:
          return this.writeExtendedQueryTask(item);
        case QueryAction.Sync:
          this.readQueue.enqueueSync();
          return this.writer.writeData(FRAME.SYNC);
        case QueryAction.SimpleQuery:
          return this.writeSimpleQueryTask(item);
        case QueryAction.Begin:
          return this.writeBeginTransactionTask(item);

        case QueryAction.Commit:
          return this.writeEndTransactionTask(item.type);

        case QueryAction.Rollback:
          return this.writeEndTransactionTask(item.type);
        case QueryAction.Close:
          await this.writer.writeData(encodeTerminateMessage());
          if (this.writer.writeOffset) await this.writer.flush();
          await this.onClose();
          item.resolve();
          return;
      }
    }
  }

  private async writeExtendedQueryTask(item: ExtendedQueryTask): Promise<void> {
    const parser = new QueryResultParser(item.resolve, item.reject, item.statement);
    this.readQueue.push(parser);
    await this.writeExtended(item.statement);
    await this.writer.writeData(FRAME.FLUSH);
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
    this.readQueue.push({ type: ReceiverType.StartTransaction });
    await this.writeExtended(statement);
  }
  private async writeEndTransactionTask(type: "COMMIT" | "ROLLBACK"): Promise<void> {
    const statement = createTypeSqlStatementEncoder(type);
    this.readQueue.push({ type: ReceiverType.EndTransaction });
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
