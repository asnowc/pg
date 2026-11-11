import type { TransactionMode } from "@/interface/Query.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { throwRewrittenError } from "@/_utils/error.ts";
import { ReceiverType } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";
import {
  BindMessageEncoder,
  DescribeMessageEncoder,
  ExecuteMessageEncoder,
  ParseMessageEncoder,
  QueryMessageEncoder,
} from "./encoder/ExtendedQuery.ts";
import { BufferWriterQueue } from "@/_utils/BufferWriterQueue.ts";
import { TerminateFrame } from "@/protocol/encoder/Message.ts";

export class QueryWriteQueue {
  constructor(
    private writer: BufferWriterQueue,
    private readonly readQueue: QueryReadQueue,
  ) {
  }

  extendedQuery<T>(statement: TypedSqlStatement): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      const parser = new QueryResultParser<any>(
        resolve,
        reject,
        statement,
        ReceiverType.ExtendedQuery,
      );
      this.readQueue.push(parser);
      this.writeExtended(parser.statement);
      this.writer.pushData(FRAME.FLUSH);
    }).catch((e) => throwRewrittenError(e));
  }

  sync(): void {
    this.readQueue.enqueueSync();
    this.writer.pushData(FRAME.SYNC);
  }

  simpleQuery<T>(statement: TypedSqlStatement): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      const parser = new QueryResultParser<any>(
        resolve,
        reject,
        statement,
        ReceiverType.SimpleQuery,
      );
      this.readQueue.enqueueSimpleQuery(parser);
      this.writer.pushEncoder(new QueryMessageEncoder(parser.statement));
    });
  }

  beginTransaction(mode?: TransactionMode): void {
    const statement = new TypedSqlStatement("BEGIN" + (mode ? " ISOLATION LEVEL " + mode : ""));
    this.writeExtended(statement);
    this.writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
    this.readQueue.push({ taskType: ReceiverType.StartTransaction });
  }
  commitTransaction(): void {
    const statement = new TypedSqlStatement("COMMIT");
    this.writeExtended(statement);
    this.readQueue.push({ taskType: ReceiverType.EndTransaction });
  }
  rollbackTransaction(): void {
    const statement = new TypedSqlStatement("ROLLBACK");
    this.writeExtended(statement);
    this.readQueue.push({ taskType: ReceiverType.EndTransaction });
  }
  destroyed() {
    this.writer.clear();
  }
  close() {
    this.writer.pushEncoder(TerminateFrame);
    return this.writer.pushClose();
  }

  private writeExtended(statement: TypedSqlStatement): void {
    this.writer.pushEncoder(new ParseMessageEncoder(statement));
    this.writer.pushEncoder(new BindMessageEncoder(statement));
    this.writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
    this.writer.pushEncoder(new ExecuteMessageEncoder(0));
  }
}
