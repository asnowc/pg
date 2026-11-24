import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { InternalError } from "@/_utils/error.ts";
import { CloseReceiver, EmptyReceiver, ReceiverType } from "./parsers/QueryTask.ts";
import { decodeError, decodeNotice, decodeNotification, decodeParameterStatus, decodeReadyForQuery } from "./decode.ts";
import { PgDatabaseError, PreviousQueryError } from "@/error.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import type { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { CountLinkList, eachLink } from "@/_utils/LinkList.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { RowDescriptionParser } from "./parsers/RowDescription.ts";

type ResultReceiver = QueryResultParser | EmptyReceiver | CloseReceiver | RowDescriptionParser;

const MSCode = BackendMessageCode;

export class QueryReadQueue {
  constructor(private onIdle?: () => void) {}
  private link = new CountLinkList<ResultReceiver>();
  get head() {
    return this.link.head;
  }

  transactionStatus = PgTransactionStatus.Idle;
  /** 已入队但尚未到达对应 ReadyForQuery 的查询数。 */
  pendingQueyNumber = 0;
  private completedQueryNumber = 0;
  push(receiver: ResultReceiver): void {
    this.link.push(receiver);
    if (receiver.taskType !== ReceiverType.Sync) this.pendingQueyNumber++;
  }
  private shift(): void {
    if (this.link.head!.taskType !== ReceiverType.Sync) this.completedQueryNumber++;
    this.link.shift();
  }
  private clear(): void {
    this.link.clear();
    this.pendingQueyNumber = 0;
    this.completedQueryNumber = 0;
  }
  enqueueSync(resolve?: () => void, reject?: (error: unknown) => void): void {
    this.push({ taskType: ReceiverType.Sync, resolve, reject });
  }
  init(parsers: MessageParsers, queryWrite: QueryWriteQueue) {
    this.initLifecycleMessageListener(parsers);
    this.initQueryMessageListener(parsers, queryWrite);
  }
  private rejectQueueToSync(error: Error) {
    while (this.head) {
      if (this.head.taskType === ReceiverType.Sync) {
        rejectReceiver(this.head, error);
        return;
      }
      rejectReceiver(this.head, error);
      this.shift();
    }
  }
  private initQueryMessageListener(parsers: MessageParsers, queryWrite: QueryWriteQueue) {
    parsers.set(MSCode.DataRow, (reader, remaining) => this.getResultReceiver().dataRow(reader, remaining));

    parsers.set(MSCode.NoData, () => {
      const current = this.getReceiver();
      switch (current.taskType) {
        case ReceiverType.ExtendedQuery:
        case ReceiverType.SimpleQuery:
        case ReceiverType.EndTransaction:
        case ReceiverType.StartTransaction:
          return;
        default:
          throw new InternalError("Unexpected NoData for the current receiver");
      }
    });

    parsers.setFullParser(MSCode.CommandComplete, (body) => {
      const current = this.getReceiver();
      switch (current.taskType) {
        case ReceiverType.SimpleQuery:
          current.commandComplete(body);
          current.reset();
          break;
        case ReceiverType.ExtendedQuery:
          current.commandComplete(body);
          this.shift();
          break;
        case ReceiverType.EndTransaction:
        case ReceiverType.StartTransaction:
          this.shift();
          break;

        default:
          throw new InternalError("Unexpected CommandComplete for the current receiver");
      }
    });
    parsers.set(MSCode.PortalSuspended, () => {
      const current = this.getResultReceiver();
      this.shift();
      current.portalSuspended();
    });
    parsers.set(MSCode.EmptyQueryResponse, () => {
      const current = this.getReceiver();
      if (current.taskType === ReceiverType.RowDescription) {
        this.shift();
        current.noData();
      }
      this.getResultReceiver().emptyQueryResponse();
    });
    parsers.setFullParser(MSCode.ErrorResponse, (body) => {
      const next = this.head;
      if (!next) throw new InternalError("Unexpected ErrorResponse: no query available");
      this.shift();
      const info = decodeError(body);
      const error = new PgDatabaseError(info.fields);
      rejectReceiver(next, error);

      const afterError = new PreviousQueryError({ cause: error });
      // PostgreSQL drops the rest of this extended segment, including transaction control.

      this.rejectQueueToSync(afterError);
      const isNoSyncInReadQueue = !this.head;
      if (isNoSyncInReadQueue) queryWrite.sync();
    });
    parsers.set(MSCode.RowDescription, (reader, remaining) => {
      const current = this.getReceiver();
      if (current.taskType === ReceiverType.RowDescription) {
        current.rowDescription(reader, remaining);
        if (current.fields !== undefined) this.shift();
      } else {
        throw new InternalError("Unexpected RowDescription for the current receiver");
      }
    });

    // 匹配 SYNC
    parsers.setFullParser(MSCode.ReadyForQuery, (body) => {
      let current = this.getReceiver();
      if (current.taskType === ReceiverType.SimpleQuery) {
        this.shift();
        current = this.getReceiver();
      }
      if (current.taskType !== ReceiverType.Sync) {
        throw new InternalError("ReadyForQuery message not matched with SYNC");
      }

      this.shift();
      const status = decodeReadyForQuery(body);
      this.transactionStatus = status;
      this.pendingQueyNumber -= this.completedQueryNumber;
      this.completedQueryNumber = 0;
      if (!this.head) this.onIdle?.();
      current.resolve?.();
    });
    parsers.set(MSCode.BindComplete, (body) => {});
    parsers.set(MSCode.CloseComplete, (body) => {
      const current = this.getReceiver();
      if (current.taskType !== ReceiverType.ClosePortal) {
        throw new InternalError("Unexpected CloseComplete for a non-close task");
      }
      this.shift();
      current.resolve();
    });
    parsers.set(MSCode.ParseComplete, (body) => {});
  }
  private getReceiver(): ResultReceiver {
    const receiver = this.head;
    if (!receiver) throw new InternalError("No receiver available");
    return receiver;
  }

  private getResultReceiver(): QueryResultParser {
    const query = this.getReceiver();
    if (!isQueryReceiver(query)) {
      throw new InternalError("Unexpected message: current query is not a query result receiver");
    }
    return query;
  }
  fail(err: Error) {
    for (const item of eachLink(this.head)) {
      rejectReceiver(item, err);
    }
    this.clear();
  }

  private initLifecycleMessageListener(parser: MessageParsers) {
    parser.setFullParser(MSCode.ParameterStatus, (data) => {
      const { name, value } = decodeParameterStatus(data);
      this.parameters[name] = value;
    });
    parser.setFullParser(MSCode.NotificationResponse, (data) => {
      const message = decodeNotification(data, new DataView(data.buffer, data.byteOffset, data.byteLength));
      const asyncData = {
        type: AsyncMessageType.Notification,
        processId: message.processId,
        channel: message.channel,
        payload: message.payload,
      };
    });
    parser.setFullParser(MSCode.NoticeResponse, (data) => {
      const message = decodeNotice(data);
      const asyncData = { type: AsyncMessageType.Notice, fields: message.fields, info: message.info };
    });
  }
  readonly parameters: Record<string, string> = {};
}

function isQueryReceiver(receiver: ResultReceiver): receiver is QueryResultParser {
  return receiver.taskType === ReceiverType.ExtendedQuery || receiver.taskType === ReceiverType.SimpleQuery;
}

function rejectReceiver(receiver: ResultReceiver, error: Error): void {
  if ("reject" in receiver && receiver.reject) receiver.reject(error);
}
