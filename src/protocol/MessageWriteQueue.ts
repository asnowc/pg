import type { FieldInfo, TransactionMode } from "@/interface/Query.ts";
import { PreparedStatement } from "@/class/PreparedStatement.ts";
import { throwRewrittenError } from "@/_utils/error.ts";
import { ReceiverType } from "./parsers/QueryTask.ts";
import { QueryReadQueue } from "./MessageReadQueue.ts";
import { FRAME } from "./static_frame.ts";
import {
  BindMessageEncoder,
  ExecuteMessageEncoder,
  getClosePortalMessageEncoder,
  getCloseStatementMessageEncoder,
  getDescribeMessageEncoder,
  ParseMessageEncoder,
  QueryMessageEncoder,
  TerminateFrame,
} from "./encode.ts";
import { BufferWriterQueue } from "@/_utils/BufferWriterQueue.ts";
import { RowDescriptionParser } from "./parsers/RowDescription.ts";
import { MultipleStatementPortal, StatementPortal } from "./QueryPortal.ts";

type OkCallBack<T = undefined | void> = (fields: T) => void;
type ErrorCallBack = (error: unknown) => void;

export class QueryWriteQueue {
  constructor(
    private writer: BufferWriterQueue,
    private readonly readQueue: QueryReadQueue,
  ) {}
  parse(statement: PreparedStatement) {
    this.writer.pushEncoder(new ParseMessageEncoder(statement));
  }
  bind(statement: PreparedStatement, portalName?: string) {
    this.writer.pushEncoder(new BindMessageEncoder(statement, portalName));
  }
  describe(portal: StatementPortal, resolve?: OkCallBack<FieldInfo[]>, reject?: ErrorCallBack) {
    const parser = new RowDescriptionParser((fields) => {
      portal.setFields(fields);
      resolve?.(fields);
    }, reject);
    this.readQueue.push(parser);
    if (portal.portalName) this.writer.pushEncoder(getDescribeMessageEncoder(portal.portalName));
    else this.writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
  }
  execute(portal: StatementPortal, maxRows: number = 0) {
    this.readQueue.push(portal);
    this.writer.pushEncoder(new ExecuteMessageEncoder(maxRows, portal.portalName));
  }
  flush() {
    this.writer.pushData(FRAME.FLUSH);
  }
  sync(resolve?: (data?: undefined) => void, reject?: ErrorCallBack): void {
    this.writer.pushData(FRAME.SYNC);
    this.readQueue.enqueueSync(resolve, reject);
  }
  closeStatement(statement: PreparedStatement, resolve?: OkCallBack, reject?: ErrorCallBack): void {
    this.readQueue.push({ taskType: ReceiverType.CloseStatement, resolve, reject });
    this.writer.pushEncoder(getCloseStatementMessageEncoder(statement.statementName));
  }
  closePortal(statement: StatementPortal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.readQueue.push({ taskType: ReceiverType.ClosePortal, resolve, reject });
      this.writer.pushEncoder(getClosePortalMessageEncoder(statement.portalName));
    }).catch(throwRewrittenError);
  }

  query(portal: MultipleStatementPortal): void {
    this.readQueue.push(new RowDescriptionParser((fields) => portal.setFields(fields)));
    this.readQueue.push(portal);
    this.writer.pushEncoder(new QueryMessageEncoder(portal.encoder, portal.statementsLength));
  }

  beginTransaction(mode?: TransactionMode): void {
    const statement = new PreparedStatement("BEGIN" + (mode ? " ISOLATION LEVEL " + mode : ""));
    writeExtended(this.writer, statement);
    this.readQueue.push({ taskType: ReceiverType.StartTransaction });
  }
  commitTransaction() {
    const statement = new PreparedStatement("COMMIT");
    writeExtended(this.writer, statement);
    this.readQueue.push({ taskType: ReceiverType.EndTransaction });
    this.sync();
  }
  rollbackTransaction() {
    const statement = new PreparedStatement("ROLLBACK");
    writeExtended(this.writer, statement);
    this.readQueue.push({ taskType: ReceiverType.EndTransaction });
    this.sync();
  }

  terminate(): Promise<void> {
    this.writer.pushEncoder(TerminateFrame);
    return this.writer.pushClose();
  }

  prepare(portal: StatementPortal) {
    this.parse(portal.statement);
    this.bind(portal.statement, portal.portalName);
  }
}
function writeExtended(writer: BufferWriterQueue, statement: PreparedStatement) {
  writer.pushEncoder(new ParseMessageEncoder(statement));
  writer.pushEncoder(new BindMessageEncoder(statement));
  writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
  writer.pushEncoder(new ExecuteMessageEncoder(0));
}
