import type { FieldInfo, TransactionMode } from "@/interface/Query.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { throwRewrittenError } from "@/_utils/error.ts";
import { QueryParserResult, ReceiverType } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";
import {
  BindMessageEncoder,
  ExecuteMessageEncoder,
  getCloseMessageEncoder,
  ParseMessageEncoder,
  QueryMessageEncoder,
} from "./encode.ts";
import { BufferWriterQueue } from "@/_utils/BufferWriterQueue.ts";
import { TerminateFrame } from "./encoder/Message.ts";
import { RowDescriptionParser } from "@/protocol/parsers/RowDescription.ts";
import { PreparedMultipleStatement } from "@/class/PreparedMultipleStatement.ts";

export class QueryWriteQueue {
  constructor(
    private writer: BufferWriterQueue,
    private readonly readQueue: QueryReadQueue,
  ) {}
  #cursorFields = new WeakMap<TypedSqlStatement, NonNullable<QueryParserResult["fields"]>>();

  extendedQuery<T>(statement: TypedSqlStatement): Promise<QueryParserResult<T>> {
    return new Promise<QueryParserResult<T>>((resolve, reject) => {
      const parser = new QueryResultParser<any>(
        resolve,
        reject,
        statement.getResultDecoder,
        ReceiverType.ExtendedQuery,
      );
      this.readQueue.push(new RowDescriptionParser((fields) => parser.setFields(fields), reject));
      this.readQueue.push(parser);
      writeExtended(this.writer, statement);
      this.writer.pushData(FRAME.FLUSH);
    }).catch(throwRewrittenError);
  }
  openCursor(statement: TypedSqlStatement): Promise<FieldInfo[]> {
    return new Promise<FieldInfo[]>((resolve, reject) => {
      this.readQueue.push(
        new RowDescriptionParser((fields) => {
          this.#cursorFields.set(statement, fields);
          resolve(fields);
        }, reject),
      );
      this.writer.pushEncoder(new ParseMessageEncoder(statement));
      this.writer.pushEncoder(new BindMessageEncoder(statement));
      this.writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
      this.writer.pushData(FRAME.FLUSH);
    }).catch(throwRewrittenError);
  }
  executePortal<T>(statement: TypedSqlStatement, maxRows: number = 0): Promise<QueryParserResult<T>> {
    return new Promise<QueryParserResult<T>>((resolve, reject) => {
      const parser = new QueryResultParser(
        <any>resolve,
        reject,
        statement.getResultDecoder,
        ReceiverType.ExtendedQuery,
      );
      const fields = this.#cursorFields.get(statement);
      if (fields) parser.setFields(fields);
      this.readQueue.push(parser);
      this.writer.pushEncoder(new ExecuteMessageEncoder(maxRows));
      this.writer.pushData(FRAME.FLUSH);
    }).catch(throwRewrittenError);
  }
  closePortal(statement?: TypedSqlStatement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readQueue.push({ taskType: ReceiverType.ClosePortal, resolve, reject });
      this.writer.pushEncoder(getCloseMessageEncoder());
      this.sync();
    })
      .then(() => {
        if (statement) this.#cursorFields.delete(statement);
      })
      .catch(throwRewrittenError);
  }
  sync(resolve?: () => void, reject?: (error: unknown) => void): void {
    this.writer.pushData(FRAME.SYNC);
    this.readQueue.enqueueSync(resolve, reject);
  }

  simpleQuery<T>(
    statement: PreparedMultipleStatement,
    onResolve?: (data: QueryParserResult<T>) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const parser = new QueryResultParser<any>(onResolve ?? (() => {}), reject, undefined, ReceiverType.SimpleQuery);
      if (onResolve) {
        this.readQueue.push(new RowDescriptionParser((fields) => parser.setFields(fields), reject));
      }
      this.readQueue.push(parser);
      this.writer.pushEncoder(new QueryMessageEncoder(statement));
      this.sync(resolve, reject);
    });
  }

  beginTransaction(mode?: TransactionMode): void {
    const statement = new TypedSqlStatement("BEGIN" + (mode ? " ISOLATION LEVEL " + mode : ""));
    writeExtended(this.writer, statement);
    this.readQueue.push({ taskType: ReceiverType.StartTransaction });
  }
  commitTransaction() {
    const statement = new TypedSqlStatement("COMMIT");
    writeExtended(this.writer, statement);
    this.readQueue.push({ taskType: ReceiverType.EndTransaction });
    this.sync();
  }
  rollbackTransaction() {
    const statement = new TypedSqlStatement("ROLLBACK");
    writeExtended(this.writer, statement);
    this.readQueue.push({ taskType: ReceiverType.EndTransaction });
    this.sync();
  }
  destroy() {
    this.writer.clear();
  }
  close(): Promise<void> {
    this.writer.pushEncoder(TerminateFrame);
    return this.writer.pushClose();
  }
}
function writeExtended(writer: BufferWriterQueue, statement: TypedSqlStatement) {
  writer.pushEncoder(new ParseMessageEncoder(statement));
  writer.pushEncoder(new BindMessageEncoder(statement));
  writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
  writer.pushEncoder(new ExecuteMessageEncoder(0));
}
