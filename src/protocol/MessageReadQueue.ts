import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { Link, LinkList } from "@/_utils/LinkList.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { ReceiverType, ResultReceiver } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { decodeError, decodeNotice, decodeNotification, decodeParameterStatus, decodeReadyForQuery } from "./decode.ts";
import { PgDatabaseError } from "@/error.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";

export class QueryReadQueue extends LinkList<ResultReceiver> {
  private failure?: Error;
  private skippingError?: PgDatabaseError;
  private readonly readyWaiters = new Map<ResultReceiver, PromiseWithResolvers<void>>();
  private readonly syncResults = new WeakMap<ResultReceiver, QueryResultParser>();
  private readonly pendingResults = new Map<QueryResultParser, boolean>();
  private readonly failedSimpleQueries = new WeakSet<QueryResultParser>();
  transactionStatus = PgTransactionStatus.Idle;

  get error(): Error | undefined {
    return this.failure;
  }
  override enqueue(item: Link<ResultReceiver>): void {
    if (this.failure) {
      if (isQueryReceiver(item)) item.reject(this.failure);
      return;
    }
    // An error can arrive before the caller has queued the transaction's Sync.
    if (this.skippingError) {
      if (item.type !== ReceiverType.Sync) {
        if (isQueryReceiver(item)) item.reject(this.skippingError);
        return;
      }
      this.skippingError = undefined;
    }
    super.enqueue(item);
  }
  enqueueSync(result?: QueryResultParser): void {
    const sync: ResultReceiver = { type: ReceiverType.Sync };
    if (result && !this.failure) {
      this.syncResults.set(sync, result);
      this.pendingResults.set(result, false);
    }
    this.enqueue(sync);
  }
  enqueueSimpleQuery(result: QueryResultParser): Promise<void> {
    if (this.failure) {
      result.reject(this.failure);
      return Promise.reject(this.failure);
    }
    const waiter = Promise.withResolvers<void>();
    this.readyWaiters.set(result, waiter);
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
      const current = this.head;
      if (!current) throw new PgProtocolError("Unexpected ErrorResponse: no query available");
      const info = decodeError(body);
      const error = new PgDatabaseError(info.fields);
      if (current.type === ReceiverType.Sync) {
        const result = this.syncResults.get(current);
        if (result) {
          result.reject(error);
          this.pendingResults.delete(result);
        } else this.fail(error);
        return;
      }
      if (current.type === ReceiverType.SimpleQuery) {
        current.reject(error);
        this.failedSimpleQueries.add(current);
        return;
      }
      // PostgreSQL drops the rest of this extended segment, including transaction control.
      while (this.head && this.head.type !== ReceiverType.Sync) {
        const skipped = this.dequeue()!;
        if (isQueryReceiver(skipped)) {
          skipped.reject(error);
          this.pendingResults.delete(skipped);
        }
      }
      if (!this.head) this.skippingError = error;
    });
    parsers.set(BackendMessageCode.EmptyQueryResponse, () => this.complete(this.getResultReceiver()));
    parsers.set(BackendMessageCode.NoData, () => {
      this.getReceiver();
    });

    parsers.set(BackendMessageCode.RowDescription, (body) => {
      this.getResultReceiver().rowDescription(body);
    });
    parsers.set(BackendMessageCode.ReadyForQuery, (body) => {
      const status = decodeReadyForQuery(body);
      const current = this.head;
      if (!current || (current.type !== ReceiverType.Sync && current.type !== ReceiverType.SimpleQuery)) {
        throw new PgProtocolError("Unexpected ReadyForQuery: no synchronization boundary available");
      }
      this.transactionStatus = status;
      if (current.type === ReceiverType.SimpleQuery) {
        if (status !== PgTransactionStatus.Idle) {
          this.fail(new PgProtocolError("Simple query left the connection in a transaction"));
          return;
        }
        this.dequeue();
        if (!this.failedSimpleQueries.has(current)) current.resolve(current);
        this.readyWaiters.get(current)?.resolve();
        this.readyWaiters.delete(current);
      } else {
        this.dequeue();
        const result = this.syncResults.get(current);
        if (result && this.pendingResults.has(result)) {
          if (!this.pendingResults.get(result)) {
            throw new PgProtocolError("Unexpected ReadyForQuery: extended query is incomplete");
          }
          this.pendingResults.delete(result);
          result.resolve(result);
        }
      }
    });
  }
  private complete(current: ResultReceiver): void {
    if (current.type === ReceiverType.SimpleQuery) return;
    this.dequeue();
    if (isQueryReceiver(current)) {
      if (this.pendingResults.has(current)) this.pendingResults.set(current, true);
      else current.resolve(current);
    }
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
    if (this.failure) return;
    this.failure = err;
    for (const item of this) {
      if (isQueryReceiver(item)) item.reject(err);
    }
    this.clear();
    for (const [result, completed] of this.pendingResults) {
      if (completed) result.reject(err);
    }
    this.pendingResults.clear();
    for (const waiter of this.readyWaiters.values()) waiter.reject(err);
    this.readyWaiters.clear();
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

function isQueryReceiver(receiver: ResultReceiver): receiver is QueryResultParser {
  return receiver.type === ReceiverType.ExtendedQuery || receiver.type === ReceiverType.SimpleQuery;
}
