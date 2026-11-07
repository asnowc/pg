import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { InternalError } from "@/_utils/error.ts";
import { ReceiverType, ResultReceiver } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { decodeError, decodeNotice, decodeNotification, decodeParameterStatus, decodeReadyForQuery } from "./decode.ts";
import { PgDatabaseError, PreviousQueryError } from "@/error.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import type { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { CountLinkList, eachLink } from "@/_utils/LinkList.ts";

export class QueryReadQueue {
  constructor(private onIdle?: () => void) {
  }
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
  enqueueSync(onReady?: () => void): void {
    this.push({ taskType: ReceiverType.Sync, onReady });
  }
  enqueueSimpleQuery(result: QueryResultParser): void {
    this.push(result);
  }
  init(parsers: MessageParsers, queryWrite: QueryWriteQueue) {
    this.initLifecycleMessageListener(parsers);
    this.initQueryMessageListener(parsers, queryWrite);
  }
  private rejectQueueToSync(error: Error) {
    while (this.head) {
      if (this.head.taskType === ReceiverType.Sync) {
        return;
      }
      if (isQueryReceiver(this.head)) {
        this.head.reject(error);
      }
      this.shift();
    }
  }
  private initQueryMessageListener(parsers: MessageParsers, queryWrite: QueryWriteQueue) {
    parsers.set(BackendMessageCode.DataRow, (reader, remaining) => this.getResultReceiver().dataRow(reader, remaining));
    parsers.set(BackendMessageCode.EmptyQueryResponse, () => {
      const current = this.popResultReceiver();
      current.rowCount = 0;
      current.resolve(current);
    });
    parsers.set(BackendMessageCode.NoData, () => {
      this.getResultReceiver(); // 确保有一个当前的结果接收器
    });

    parsers.setFullParser(BackendMessageCode.CommandComplete, (body) => {
      const current = this.popResultReceiver();
      current.commandComplete(body);
      current.resolve(current);
    });
    parsers.set(BackendMessageCode.PortalSuspended, () => {
      const current = this.popResultReceiver();
      if (current.taskType !== ReceiverType.ExtendedQuery) {
        throw new InternalError("Unexpected PortalSuspended for a simple query");
      }
      current.resolve(current);
    });
    parsers.setFullParser(BackendMessageCode.ErrorResponse, (body) => {
      const next = this.head;
      if (!next) throw new InternalError("Unexpected ErrorResponse: no query available");
      this.shift();
      const info = decodeError(body);
      const error = new PgDatabaseError(info.fields);
      if (isQueryReceiver(next)) next.reject(error);

      const afterError = new PreviousQueryError({ cause: error });
      // PostgreSQL drops the rest of this extended segment, including transaction control.

      this.rejectQueueToSync(afterError);
      const isNoSyncInReadQueue = !this.head;
      if (isNoSyncInReadQueue) queryWrite.sync();
    });
    parsers.set(BackendMessageCode.RowDescription, (reader, remaining) => {
      return this.getResultReceiver().rowDescription(reader, remaining);
    });

    // 匹配 SYNC
    parsers.setFullParser(BackendMessageCode.ReadyForQuery, (body) => {
      const current = this.head;
      if (!current || current.taskType !== ReceiverType.Sync) {
        throw new InternalError("ReadyForQuery message  not matched with SYNC");
      }
      this.shift();
      const status = decodeReadyForQuery(body);
      this.transactionStatus = status;
      this.pendingQueyNumber -= this.completedQueryNumber;
      this.completedQueryNumber = 0;
      current.onReady?.();
      if (!this.head) this.onIdle?.();
    });
    parsers.set(BackendMessageCode.BindComplete, (body) => {
    });
    parsers.set(BackendMessageCode.CloseComplete, (body) => {
    });
    parsers.set(BackendMessageCode.ParseComplete, (body) => {
    });
  }

  private popReceiver(): ResultReceiver {
    const receiver = this.head;
    if (!receiver) throw new InternalError("No receiver available to pop");

    this.shift();
    return receiver;
  }
  private popResultReceiver(): QueryResultParser<unknown> {
    const receiver = this.popReceiver();
    if (!isQueryReceiver(receiver)) {
      throw new InternalError("No query result receiver available to pop");
    }
    return receiver;
  }

  private getResultReceiver(): QueryResultParser<unknown> {
    const query = this.head;
    if (!query || !isQueryReceiver(query)) {
      throw new InternalError("Unexpected message: current query is not a query result receiver");
    }
    return query;
  }
  fail(err: Error) {
    for (const item of eachLink(this.head)) {
      if (isQueryReceiver(item)) item.reject(err);
    }
    this.clear();
  }

  private initLifecycleMessageListener(parser: MessageParsers) {
    parser.setFullParser(BackendMessageCode.ParameterStatus, (data) => {
      const { name, value } = decodeParameterStatus(data);
      this.parameters[name] = value;
    });
    parser.setFullParser(BackendMessageCode.NotificationResponse, (data) => {
      const message = decodeNotification(data, new DataView(data.buffer, data.byteOffset, data.byteLength));
      const asyncData = {
        type: AsyncMessageType.Notification,
        processId: message.processId,
        channel: message.channel,
        payload: message.payload,
      };
    });
    parser.setFullParser(BackendMessageCode.NoticeResponse, (data) => {
      const message = decodeNotice(data);
      const asyncData = { type: AsyncMessageType.Notice, fields: message.fields, info: message.info };
    });
  }
  readonly parameters: Record<string, string> = {};
}

function isQueryReceiver(receiver: ResultReceiver): receiver is QueryResultParser {
  return receiver.taskType === ReceiverType.ExtendedQuery || receiver.taskType === ReceiverType.SimpleQuery;
}
