import type { FieldInfo, SqlStatements, TransactionMode } from "@/interface/Query.ts";
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
  getDescribeMessageEncoder,
  ParseMessageEncoder,
  QueryMessageEncoder,
  TerminateFrame,
} from "./encode.ts";
import { BufferWriterQueue } from "@/_utils/BufferWriterQueue.ts";
import { RowDescriptionParser } from "./parsers/RowDescription.ts";
import { MultipleStatementPortal, QueryPortalOptions, StatementPortal } from "./QueryPortal.ts";

export class QueryWriteQueue {
  constructor(
    private writer: BufferWriterQueue,
    private readonly readQueue: QueryReadQueue,
  ) {}

  prepare(portal: StatementPortal) {
    this.writer.pushEncoder(new ParseMessageEncoder(portal.statement));
    this.writer.pushEncoder(new BindMessageEncoder(portal.statement, portal.portalName));
  }

  describe(portal: StatementPortal, resolve: (fields: FieldInfo[]) => void, reject: (error: unknown) => void) {
    this.readQueue.push(new RowDescriptionParser(resolve, reject));
    if (portal.portalName) this.writer.pushEncoder(getDescribeMessageEncoder(portal.portalName));
    else {
      this.writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
    }
  }
  execute(portal: StatementPortal, maxRows: number = 0) {
    this.readQueue.push(portal);
    this.writer.pushEncoder(new ExecuteMessageEncoder(maxRows, portal.portalName));
  }
  flush() {
    this.writer.pushData(FRAME.FLUSH);
  }
  sync(resolve?: () => void, reject?: (error: unknown) => void): void {
    this.writer.pushData(FRAME.SYNC);
    this.readQueue.enqueueSync(resolve, reject);
  }

  query(portal: MultipleStatementPortal): void {
    this.readQueue.push(
      new RowDescriptionParser(
        (fields) => portal.setFields(fields),
        () => {},
      ),
    );
    this.readQueue.push(portal);
    this.writer.pushEncoder(new QueryMessageEncoder(portal.encoder, portal.statementsLength));
  }

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
      this.readQueue.push(new RowDescriptionParser(resolve, reject));
      this.writer.pushEncoder(new ParseMessageEncoder(statement));
      this.writer.pushEncoder(new BindMessageEncoder(statement));
      this.writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
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
      this.readQueue.push(parser);
      this.writer.pushEncoder(new ExecuteMessageEncoder(maxRows));
      this.writer.pushData(FRAME.FLUSH);
    }).catch(throwRewrittenError);
  }
  closePortal(statement: TypedSqlStatement): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readQueue.push({ taskType: ReceiverType.ClosePortal, resolve, reject });
      this.writer.pushEncoder(getCloseMessageEncoder(statement.statementName));
      this.sync();
    }).catch(throwRewrittenError);
  }

  simpleQuery(portal: MultipleStatementPortal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.query(portal);
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
