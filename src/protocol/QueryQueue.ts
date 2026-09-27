import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import type { TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { type MessageRequest, QueryAction, ResultReceiver } from "./parsers/QueryResult.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";

export class QueryResultQueue {
  constructor(parsers: MessageParsers) {
    parsers.set(BackendMessageCode.DataRow, (body) => {
      this.getCurrentQuery().dataRow(body);
    });
    parsers.set(BackendMessageCode.CommandComplete, (body) => {
    });
    parsers.set(BackendMessageCode.ErrorResponse, (body) => {
    });
    parsers.set(BackendMessageCode.EmptyQueryResponse, (body) => {
    });
    parsers.set(BackendMessageCode.NoData, () => {
      this.getCurrentQuery().noData();
    });
    parsers.set(BackendMessageCode.PortalSuspended, () => {
      this.getCurrentQuery().portalSuspended();
    });
    parsers.set(BackendMessageCode.RowDescription, (body) => {
      this.getCurrentQuery().rowDescription(body);
    });
    parsers.set(BackendMessageCode.ReadyForQuery, (body) => {
    });
  }

  private transactionStatus: PgTransactionStatus = PgTransactionStatus.Idle;
  readonly maxPipelineCount: number = 100;
  private pipelineCount: number = 0;
  private writeQueue = new LinkList<MessageRequest>();
  extendedQuery<T>(statement: TypedSqlStatementEncoder): Promise<QueryResultParser<T>> {
    return new Promise<QueryResultParser<any>>((resolve, reject) => {
      this.writeQueue.enqueue({
        type: QueryAction.ExtendedQuery,
        statement,
        resolve,
        reject,
      });
    });
  }
  beginTransaction(statement: TypedSqlStatementEncoder) {
    this.writeQueue.enqueue({
      type: QueryAction.StartTransaction,
    });
  }
  simpleQuery(statement: TypedSqlStatementEncoder) {}

  private previousAction?: QueryAction;
  checkWriteQueue(type: number) {
    const { writeQueue, readQueue } = this;
    let item = writeQueue.dequeue();
    while (item) {
      switch (item.type) {
        case QueryAction.ExtendedQuery: {
          // readQueue.enqueue();
          const resver = new QueryResultParser(item.resolve, item.reject, item.statement);
          readQueue.enqueue(resver);
          break;
        }
        case QueryAction.SimpleQuery:
          break;
        case QueryAction.StartTransaction:
          break;
        case QueryAction.EndTransaction:
          break;
        default:
          break;
      }
      this.previousAction = item.type;
      item = writeQueue.dequeue();
    }
  }

  private readQueue = new LinkList<ResultReceiver>();

  private getCurrentQuery<T>(): QueryResultParser<T> {
    const query = this.readQueue.head;
    if (!query) throw new PgProtocolError("No current query available");
    if (isQueryQueryResultReceiver(query)) return query as QueryResultParser<T>;
    throw new PgProtocolError("Current query is not a query result receiver");
  }
}
function isQueryQueryResultReceiver(receiver: unknown): receiver is QueryResultParser {
  return receiver instanceof QueryResultParser;
}
