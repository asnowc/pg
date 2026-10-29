import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { InternalError } from "@/_utils/error.ts";
import { ReceiverType, ResultReceiver } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import {
  createRowDescriptionDecoder,
  decodeError,
  decodeNotice,
  decodeNotification,
  decodeParameterStatus,
  decodeReadyForQuery,
} from "./decode.ts";
import { PgDatabaseError, PreviousQueryError } from "@/error.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import type { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { CountLinkList, eachLink } from "@/_utils/LinkList.ts";

export class QueryReadQueue extends CountLinkList<ResultReceiver> {
  transactionStatus = PgTransactionStatus.Idle;

  enqueueSync(result?: QueryResultParser): void {
    this.push({ type: ReceiverType.Sync });
  }
  enqueueSimpleQuery(result: QueryResultParser): Promise<void> {
    const waiter = Promise.withResolvers<void>();
    this.push(result);
    return waiter.promise;
  }
  init(parsers: MessageParsers, queryWrite: QueryWriteQueue) {
    this.initLifecycleMessageListener(parsers);
    this.initQueryMessageListener(parsers, queryWrite);
  }
  private rejectQueueToSync(error: Error) {
    while (this.head) {
      if (this.head.type === ReceiverType.Sync) {
        return;
      }
      if (isQueryReceiver(this.head)) {
        this.head.reject(error);
      }
      this.shift();
    }
  }
  private initQueryMessageListener(parsers: MessageParsers, queryWrite: QueryWriteQueue) {
    parsers.set(BackendMessageCode.DataRow, (body) => this.getResultReceiver().dataRow(body));
    parsers.set(BackendMessageCode.EmptyQueryResponse, () => {
      this.getResultReceiver(); // 确保有一个当前的结果接收器
    });
    parsers.set(BackendMessageCode.NoData, () => {
      this.getResultReceiver(); // 确保有一个当前的结果接收器
    });

    parsers.set(BackendMessageCode.CommandComplete, (body) => {
      const current = this.popResultReceiver();
      current.commandComplete(body);
      current.resolve(current);
    });
    parsers.set(BackendMessageCode.PortalSuspended, () => {
      const current = this.popResultReceiver();
      if (current.type !== ReceiverType.ExtendedQuery) {
        throw new InternalError("Unexpected PortalSuspended for a simple query");
      }
      current.resolve(current);
    });
    parsers.set(BackendMessageCode.ErrorResponse, (body) => {
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
      if (isNoSyncInReadQueue) {
        queryWrite.clearWriteQueueForSync(); // queue has no SYNC, so we need to clear the write queue and send a SYNC immediately
      }
    });
    parsers.set(BackendMessageCode.RowDescription, createRowDescriptionDecoder(), (body) => {
      this.getResultReceiver().rowDescription(body);
    });

    // 匹配 SYNC
    parsers.set(BackendMessageCode.ReadyForQuery, (body) => {
      const current = this.head;
      if (!current || current.type !== ReceiverType.Sync) {
        throw new InternalError("ReadyForQuery message  not matched with SYNC");
      }
      this.shift();
      const status = decodeReadyForQuery(body);
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
    parser.set(BackendMessageCode.ParameterStatus, (data) => {
      const { name, value } = decodeParameterStatus(data);
      this.parameters[name] = value;
    });
    parser.set(BackendMessageCode.NotificationResponse, (data) => {
      const message = decodeNotification(data);
      const asyncData = {
        type: AsyncMessageType.Notification,
        processId: message.processId,
        channel: message.channel,
        payload: message.payload,
      };
    });
    parser.set(BackendMessageCode.NoticeResponse, (data) => {
      const message = decodeNotice(data);
      const asyncData = { type: AsyncMessageType.Notice, fields: message.fields, info: message.info };
    });
  }
  readonly parameters: Record<string, string> = {};
}

function isQueryReceiver(receiver: ResultReceiver): receiver is QueryResultParser {
  return receiver.type === ReceiverType.ExtendedQuery || receiver.type === ReceiverType.SimpleQuery;
}
