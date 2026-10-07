import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode } from "./const.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { ReceiverType, ResultReceiver } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { decodeError, decodeNotice, decodeNotification, decodeParameterStatus, decodeReadyForQuery } from "./decode.ts";
import { PgDatabaseError } from "@/error.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";

export class QueryReadQueue extends LinkList<ResultReceiver> {
  init(parsers: MessageParsers) {
    this.initLifecycleMessageListener(parsers);
    this.initQueryMessageListener(parsers);
  }
  private initQueryMessageListener(parsers: MessageParsers) {
    parsers.set(BackendMessageCode.DataRow, (body) => this.getResultReceiver().dataRow(body));
    parsers.set(BackendMessageCode.CommandComplete, (body) => {
      const current = this.getResultReceiver();
      current.commandComplete(body);
      if (current.type === ReceiverType.ExtendedQuery) {
        current.resolve(current);
        this.readQueue.dequeue();
      }
    });
    parsers.set(BackendMessageCode.PortalSuspended, () => {
      const current = this.getResultReceiver();
      this.readQueue.dequeue();
      current.resolve(current);
    });
    parsers.set(BackendMessageCode.ErrorResponse, (body) => {
      const current = this.getResultReceiver();
      this.readQueue.dequeue();
      const info = decodeError(body);
      current.reject(new PgDatabaseError(info.fields));

      //TODO:
      if (current.type === ReceiverType.ExtendedQuery) {
      } else {
      }
    });
    parsers.set(BackendMessageCode.EmptyQueryResponse, (body) => {}); // skip
    parsers.set(BackendMessageCode.NoData, () => {}); //skip

    parsers.set(BackendMessageCode.RowDescription, (body) => {
      this.getResultReceiver().rowDescription(body);
      this.readQueue.dequeue();
    });
    parsers.set(BackendMessageCode.ReadyForQuery, (body) => {
      const status = decodeReadyForQuery(body);
      const next = this.readQueue.head;
    });
  }
  private readQueue = new LinkList<ResultReceiver>();

  private getResultReceiver(): QueryResultParser<unknown> {
    const query = this.readQueue.head;
    if (!query) throw new PgProtocolError("Unexpected message: no query available");
    if (query.type !== ReceiverType.SimpleQuery && query.type !== ReceiverType.ExtendedQuery) {
      throw new PgProtocolError("Unexpected message: current query is not a query result receiver");
    }
    return query;
  }
  fail(err: Error) {
    this.clear();
    for (const item of this.readQueue) {
      if (item.type === ReceiverType.ExtendedQuery || item.type === ReceiverType.SimpleQuery) {
        item.reject(err);
      }
    }
    this.readQueue.clear();
  }

  initLifecycleMessageListener(parser: MessageParsers) {
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
