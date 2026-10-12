import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { ReceiverType, ResultReceiver } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { decodeError, decodeNotice, decodeNotification, decodeParameterStatus, decodeReadyForQuery } from "./decode.ts";
import { PgDatabaseError } from "@/error.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";

export class QueryReadQueue extends LinkList<ResultReceiver> {
  transactionStatus = PgTransactionStatus.Idle;

  enqueueSync(result?: QueryResultParser): void {
    this.enqueue({ type: ReceiverType.Sync });
  }
  enqueueSimpleQuery(result: QueryResultParser): Promise<void> {
    const waiter = Promise.withResolvers<void>();
    this.enqueue(result);
    return waiter.promise;
  }
  init(parsers: MessageParsers) {
    this.initLifecycleMessageListener(parsers);
    this.initQueryMessageListener(parsers);
  }
  private initQueryMessageListener(parsers: MessageParsers) {
    parsers.set(BackendMessageCode.DataRow, (body) => this.getResultReceiver().dataRow(body));

    parsers.set(BackendMessageCode.CommandComplete, (body) => {
      const current = this.getReceiver();
      if (isQueryReceiver(current)) current.commandComplete(body);
      this.complete(current);
    });
    parsers.set(BackendMessageCode.PortalSuspended, () => {
      const current = this.getResultReceiver();
      if (current.type !== ReceiverType.ExtendedQuery) {
        throw new PgProtocolError("Unexpected PortalSuspended for a simple query");
      }
      this.complete(current);
    });
    parsers.set(BackendMessageCode.ErrorResponse, (body) => {
      if (!this.head) throw new PgProtocolError("Unexpected ErrorResponse: no query available");
      const info = decodeError(body);
      const error = new PgDatabaseError(info.fields);
      // PostgreSQL drops the rest of this extended segment, including transaction control.
      while (this.head && this.head.type !== ReceiverType.Sync) {
        if (isQueryReceiver(this.head)) {
          this.head.reject(error);
          this.dequeue();
        }
      }
    });
    parsers.set(BackendMessageCode.EmptyQueryResponse, () => this.complete(this.getResultReceiver()));
    parsers.set(BackendMessageCode.NoData, () => {
      this.getReceiver();
    });

    parsers.set(BackendMessageCode.RowDescription, (body) => {
      this.getResultReceiver().rowDescription(body);
    });
    parsers.set(BackendMessageCode.ReadyForQuery, (body) => {
      const current = this.head;
      const status = decodeReadyForQuery(body);
    });
    parsers.set(BackendMessageCode.BindComplete, (body) => {
    });
    parsers.set(BackendMessageCode.CloseComplete, (body) => {
    });
    parsers.set(BackendMessageCode.ParseComplete, (body) => {
    });
  }
  /** 每当一个查询完成时调用 */
  private complete(current: ResultReceiver): void {
    this.dequeue();
    if (current.type === ReceiverType.SimpleQuery) return;
  }
  private getReceiver(): ResultReceiver {
    const query = this.head;
    if (!query) throw new PgProtocolError("Unexpected message: no query available");
    if (query.type === ReceiverType.Sync) {
      throw new PgProtocolError("Unexpected query message at a synchronization boundary");
    }
    return query;
  }
  private getResultReceiver(): QueryResultParser<unknown> {
    const query = this.getReceiver();
    if (!isQueryReceiver(query)) {
      throw new PgProtocolError("Unexpected message: current query is not a query result receiver");
    }
    return query;
  }
  fail(err: Error) {
    for (const item of this) {
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
