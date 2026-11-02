import type { TransactionMode, TypedSqlStatement } from "@/interface/Query.ts";
import { throwRewrittenError } from "@/_utils/error.ts";
import { BeginTransactionTask, PgMessageTask, QueryAction, ReceiverType } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
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
import { InternalTextSqlStatementEncoder } from "@/codec/StatementEncoder.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";

export class QueryWriteQueue extends BufferWriterQueue<PgMessageTask> {
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
      if (item.taskType === QueryAction.ExtendedQuery || item.taskType === QueryAction.SimpleQuery) {
        item.reject(error);
      }
    }
    super.clear();
  }
  extendedQuery<T>(statement: TypedSqlStatement): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      const parser = new QueryResultParser<any>(
        resolve,
        reject,
        statement,
        QueryAction.ExtendedQuery,
      );
      this.push(parser);
    }).catch((e) => throwRewrittenError(e));
  }
  sync(): void {
    this.push({ taskType: QueryAction.Sync });
  }
  clearWriteQueueForSync(): void {
    let item = this.queueHead;
    while (item) {
      if (item.taskType === QueryAction.Sync) return;
      this.shift();
      item = this.queueHead;
    }
    this.sync();
  }

  simpleQuery<T>(statement: TypedSqlStatement): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      const parser = new QueryResultParser<any>(
        resolve,
        reject,
        statement,
        QueryAction.SimpleQuery,
      );
      this.push(parser);
    });
  }
  beginTransaction(mode?: TransactionMode): void {
    this.push({ taskType: QueryAction.Begin, mode });
  }
  commitTransaction(): void {
    this.push({ taskType: QueryAction.Commit });
  }
  rollbackTransaction(): void {
    this.push({ taskType: QueryAction.Rollback });
  }
  close() {
    return new Promise<void>((resolve, reject) => {
      this.push({ taskType: QueryAction.Close, resolve, reject });
    });
  }

  protected override async processItemWrite(item: PgMessageTask): Promise<void> {
    // 需要确保函数调用到  this.readQueue.enqueueSync() 是同步的
    // 否则 clearWriteQueueForSync 会情况当前正在处理的 SYNC 之后的任务
    while (item) {
      switch (item.taskType) {
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
          return this.writeEndTransactionTask(item.taskType);

        case QueryAction.Rollback:
          return this.writeEndTransactionTask(item.taskType);
        case QueryAction.Close:
          await this.writer.writeData(encodeTerminateMessage());
          if (this.writer.writeOffset) await this.writer.flush();
          await this.onClose();
          item.resolve();
          return;
      }
    }
  }

  private async writeExtendedQueryTask(parser: QueryResultParser): Promise<void> {
    this.readQueue.push(parser);
    await this.writeExtended(parser.statement);
    await this.writer.writeData(FRAME.FLUSH);
  }
  private async writeSimpleQueryTask(parser: QueryResultParser): Promise<void> {
    const message = encodeQueryMessage({
      calculateByteLength: () => parser.statement.calculateQueryByteLength(),
      encodeQueryInto: (buffer, offset) => parser.statement.encodeQueryInto(buffer, offset),
    });

    const ready = this.readQueue.enqueueSimpleQuery(parser);
    await this.writer.writeData(message);
    return ready;
  }

  private async writeBeginTransactionTask(item: BeginTransactionTask): Promise<void> {
    const statement = new InternalTextSqlStatementEncoder("BEGIN" + (item.mode ? " ISOLATION LEVEL " + item.mode : ""));
    this.readQueue.push({ type: ReceiverType.StartTransaction });
    await this.writeExtended(statement);
  }
  private async writeEndTransactionTask(type: "COMMIT" | "ROLLBACK"): Promise<void> {
    const statement = new InternalTextSqlStatementEncoder(type);
    this.readQueue.push({ type: ReceiverType.EndTransaction });
    this.readQueue.enqueueSync();
    await this.writeExtended(statement);
  }

  private async writeExtended(statement: TypedSqlStatement): Promise<void> {
    await this.writer.writeData(encodeParseMessage(statement));
    await this.writer.writeData(encodeBindMessage(statement));
    await this.writer.writeData(encodeDescribeMessage(DescribeTarget.Portal));
    await this.writer.writeData(encodeExecuteMessage(0));
  }
}
