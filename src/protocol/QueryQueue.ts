import { MessageParsers } from "./parsers/MessageParser.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { QueryAction, type QueryTask } from "./parsers/QueryTask.ts";
import { QueryResultParser } from "./parsers/QueryResultParser.ts";
import {
  decodeReadyForQuery,
  DescribeTarget,
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
  encodeQueryMessage,
  FRAME,
} from "@/protocol.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import type { StreamWriter } from "@/_utils/StreamWriter.ts";

type PromiseResolve<T> = {
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

type PendingQuery = {
  parser: QueryResultParser;
  result?: QueryResultParser;
  error?: unknown;
  resolve: (result: QueryResultParser) => void;
  reject: (reason: unknown) => void;
  immediate: boolean;
};
type PendingSync = { onReady: (status: PgTransactionStatus) => void; reject?: (reason: unknown) => void };
type PendingSimple = {
  simple: true;
  rollback?: true;
  parser: QueryResultParser;
  results: QueryResultParser[];
  error?: unknown;
  resolve: (results: QueryResultParser[]) => void;
  reject: (reason: unknown) => void;
};
type PendingResult = PendingQuery | PendingSync | PendingSimple;
interface Writer {
  write(data: Uint8Array): Promise<number>;
}
export class QueryResultQueue {
  constructor(parsers: MessageParsers, private readonly writer: StreamWriter) {
    parsers.set(BackendMessageCode.DataRow, (body) => {
      this.getCurrentQuery().dataRow(body);
    });
    parsers.set(BackendMessageCode.CommandComplete, (body) => {
      const current = this.readQueue[0];
      this.getCurrentQuery().commandComplete(body);
      if (current && "simple" in current) this.nextSimpleResult(current);
      else this.readQueue.shift();
    });
    parsers.set(BackendMessageCode.ErrorResponse, (body) => {
      const current = this.readQueue[0];
      this.getCurrentQuery().errorResponse(body);
      if (current && "simple" in current) return;
      this.readQueue.shift();
      this.skipUntilSync = true;
      if (current && "parser" in current && current.immediate) void this.synchronize().catch(() => {});
    });
    parsers.set(BackendMessageCode.EmptyQueryResponse, (body) => {
      const current = this.readQueue[0];
      this.getCurrentQuery().emptyQueryResponse();
      if (current && "simple" in current) this.nextSimpleResult(current);
      else this.readQueue.shift();
    });
    parsers.set(BackendMessageCode.NoData, () => {
      this.getCurrentQuery().noData();
    });
    parsers.set(BackendMessageCode.PortalSuspended, () => {
      this.getCurrentQuery().portalSuspended();
      this.readQueue.shift();
    });
    parsers.set(BackendMessageCode.RowDescription, (body) => {
      this.getCurrentQuery().rowDescription(body);
    });
    parsers.set(BackendMessageCode.ReadyForQuery, (body) => {
      const status = decodeReadyForQuery(body);
      this.transactionStatus = status;
      const current = this.readQueue[0];
      if (current && "simple" in current) {
        this.readQueue.shift();
        if (current.rollback) {
          if (status !== PgTransactionStatus.Idle) this.fail(new PgProtocolError("ROLLBACK did not end transaction"));
          current.reject(current.error);
          this.pipelineCount--;
          this.checkWriteQueue();
          if (!this.hasPending) this.onIdle?.();
          return;
        }
        if (status !== PgTransactionStatus.Idle) {
          this.writer.pushData(encodeQueryMessage(this.asSimpleEncoder(createTypeSqlStatementEncoder("ROLLBACK"))));
          const rollback: PendingSimple = {
            simple: true,
            rollback: true,
            parser: undefined as unknown as QueryResultParser,
            results: [],
            resolve: () => {},
            reject: current.reject,
            error: new PgProtocolError("Simple query left the connection in a transaction"),
          };
          this.nextSimpleResult(rollback);
          this.readQueue.unshift(rollback);
          return;
        }
        if (current.error) current.reject(current.error);
        else current.resolve(current.results);
        this.pipelineCount--;
        this.checkWriteQueue();
        if (!this.hasPending) this.onIdle?.();
        return;
      }
      if (this.skipUntilSync) {
        while (this.readQueue.length && "parser" in this.readQueue[0] && !("simple" in this.readQueue[0])) {
          const skipped = this.readQueue.shift();
          if (skipped && "parser" in skipped) {
            skipped.reject(new PgProtocolError("Query skipped after an error before Sync"));
          }
        }
        this.skipUntilSync = false;
      }
      const sync = this.readQueue.shift();
      if (!sync || "parser" in sync) throw new PgProtocolError("Unexpected ReadyForQuery");
      sync.onReady(status);
      this.pipelineCount--;
      this.checkWriteQueue();
      if (!this.hasPending) this.onIdle?.();
    });
  }

  private transactionStatus: PgTransactionStatus = PgTransactionStatus.Idle;
  private writeTransactionStatus: PgTransactionStatus = PgTransactionStatus.Idle;
  
  readonly maxPipelineCount: number = 100;
  private pipelineCount: number = 0;
  private writeQueue = new LinkList<QueryTask>();
  private skipUntilSync = false;
  private failed?: unknown;
  get isFailed(): boolean {
    return this.failed !== undefined;
  }
  onIdle?: () => void;
  get hasPending(): boolean {
    return this.readQueue.length > 0 || !!this.writeQueue.head;
  }
  enqueue(task: QueryTask) {
    this.writeQueue.enqueue(task);
    this.checkWriteQueue();
  }
  extendedQuery<T>(
    statement: TypedSqlStatementEncoder,
    sync = true,
  ): Promise<QueryResultParser<T>> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise<QueryResultParser<T>>((resolve, reject) => {
      this.writeQueue.enqueue({
        type: QueryAction.ExtendedQuery,
        statement,
        resolve: resolve as (value: QueryResultParser) => void,
        reject,
        sync,
      });
      this.checkWriteQueue();
    });
  }
  synchronize(): Promise<PgTransactionStatus> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.writer.pushData(FRAME.SYNC);
      this.readQueue.push({ onReady: resolve, reject });
      this.pipelineCount++;
    });
  }
  async beginTransaction(mode?: TransactionMode): Promise<void> {
    if (this.hasPending) {
      const prior = this.synchronize();
      void prior.catch(() => {});
    }
    await this.extendedQuery(createTypeSqlStatementEncoder(`BEGIN${mode ? ` ISOLATION LEVEL ${mode}` : ""}`), false);
  }
  fail(reason: unknown): void {
    if (this.failed) return;
    this.failed = reason ?? new PgProtocolError("Connection closed");
    for (const receiver of this.readQueue) receiver.reject?.(this.failed);
    this.readQueue.length = 0;
    let request = this.writeQueue.dequeue();
    while (request) {
      if ("reject" in request) request.reject(this.failed);
      request = this.writeQueue.dequeue();
    }
    this.pipelineCount = 0;
    this.onIdle?.();
  }
  simpleQuery(statement: TypedSqlStatementEncoder): Promise<QueryResultParser[]> {
    if (this.failed) return Promise.reject(this.failed);
    return new Promise((resolve, reject) => {
      this.writeQueue.enqueue({ type: QueryAction.SimpleQuery, statement, resolve, reject });
      this.checkWriteQueue();
    });
  }

  private asSimpleEncoder(statement: TypedSqlStatementEncoder) {
    return {
      calculateByteLength: () => statement.calculateQueryByteLength(),
      encodeQueryInto: (data: Uint8Array, offset: number) => statement.encodeQueryInto(data, offset),
    };
  }

  private nextSimpleResult(receiver: PendingSimple): void {
    receiver.parser = new QueryResultParser(
      (result) => receiver.results.push(result),
      (error) => receiver.error = error,
      this.simpleDecoder,
    );
  }
  private readonly simpleDecoder = Object.assign(createTypeSqlStatementEncoder(""), {
    typeDecoders: PG_DATA_DECODER_V1,
  });

  checkWriteQueue() {
    const { writeQueue } = this;
    while (this.pipelineCount < this.maxPipelineCount && !this.readQueue.some((entry) => "simple" in entry)) {
      const item = writeQueue.dequeue();
      if (!item) break;
      try {
        switch (item.type) {
          case QueryAction.ExtendedQuery: {
            const parse = encodeParseMessage(item.statement);
            const bind = encodeBindMessage(item.statement);
            const describe = encodeDescribeMessage(DescribeTarget.Portal);
            const execute = encodeExecuteMessage(0);
            const receiver: PendingQuery = {
              parser: undefined as unknown as QueryResultParser,
              resolve: item.resolve,
              reject: item.reject,
              immediate: !item.sync,
            };
            receiver.parser = new QueryResultParser(
              (result) => {
                if (receiver.immediate) receiver.resolve(result);
                else receiver.result = result;
              },
              (error) => {
                if (receiver.immediate) receiver.reject(error);
                else receiver.error = error;
              },
              item.statement,
            );
            this.readQueue.push(receiver);
            this.writer.pushData(parse);
            this.writer.pushData(bind);
            this.writer.pushData(describe);
            this.writer.pushData(execute);
            if (item.sync) {
              this.writer.pushData(FRAME.SYNC);
              this.readQueue.push({
                onReady: () => {
                  if (receiver.error) receiver.reject(receiver.error);
                  else if (receiver.result) receiver.resolve(receiver.result);
                },
                reject: receiver.reject,
              });
              this.pipelineCount++;
            } else this.writer.pushData(FRAME.FLUSH);
            break;
          }
          case QueryAction.SimpleQuery:
            {
              const message = encodeQueryMessage(this.asSimpleEncoder(item.statement));
              const receiver: PendingSimple = {
                simple: true,
                parser: undefined as unknown as QueryResultParser,
                results: [],
                resolve: item.resolve,
                reject: item.reject,
              };
              this.nextSimpleResult(receiver);
              this.readQueue.push(receiver);
              this.writer.pushData(message);
              this.pipelineCount++;
            }
            break;
        }
      } catch (error) {
        item.reject(error);
        this.fail(error);
        return;
      }
    }
  }

  private readQueue: PendingResult[] = [];

  private getCurrentQuery<T>(): QueryResultParser<T> {
    const query = this.readQueue[0];
    if (!query) throw new PgProtocolError("No current query available");
    if ("parser" in query) return query.parser as QueryResultParser<T>;
    throw new PgProtocolError("Current query is not a query result receiver");
  }

  writable: boolean = true;
  /** 等待结果的任务数量 */
  waitingQueryResultNumber: number = 0;
}
