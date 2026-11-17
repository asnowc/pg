import type {
  Cursor,
  CursorOpenOptions,
  CursorQueryOperation,
  MultipleQueryOperation,
  QueryOptions,
  QueryReader as IQueryReader,
  SampleQueryReader,
  SingleQueryOperation,
  SqlStatement,
  SqlStatements,
  Transaction as ITransaction,
  TransactionMode,
  TransactionQueryOperation,
} from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./private/sql_statement.ts";
import QueryReader from "./private/QueryReader.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import Transaction from "./private/Transaction.ts";
import { QueryWriteQueue } from "@/protocol/MessageWriteQueue.ts";

export class QueryOperation
  implements MultipleQueryOperation, SingleQueryOperation, CursorQueryOperation, TransactionQueryOperation {
  constructor(session: PgSession, onFinished?: () => void, onError?: () => void) {
    this.#session = session;
    this.#writer = session.queryWriter;
    if (onFinished) {
      session.on("close", onFinished);
      this.#onFinished = onFinished;
    }
    if (onError) {
      session.on("error", onError);
      this.#onError = onError;
    }
  }
  #onError?: () => void;
  #onFinished?: () => void;

  #session?: PgSession;
  #getSession() {
    if (!this.#session) throw new Error("Session is not available");
    return this.#session;
  }
  #writer?: QueryWriteQueue;
  #transferWriter() {
    const writer = this.#getWriter();
    this.#writer = undefined;
    return writer;
  }
  #getWriter() {
    const writer = this.#writer;
    if (!writer) throw new Error("Session writer is not available");
    return writer;
  }
  #releaseWriter = () => {
    if (this.#writer) return;
    this.#writer = this.#getSession().queryWriter;
  };

  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): IQueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReader(() => {
      return new Promise((resolve) => {
        const writer = this.#getWriter();
        const promise = writer.extendedQuery<T>(encoder);
        writer.sync();
        resolve(promise);
      });
    });
  }

  begin(mode?: TransactionMode): ITransaction {
    return new Transaction(this.#transferWriter(), this.#releaseWriter, mode);
  }
  open<T>(queryable: SqlStatement | TypedSqlStatement<T>, options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }

  queryMultiple(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: unknown, _options?: unknown): SampleQueryReader {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    throw new Error("Not implemented");
  }
  static getSessionSafe(operation: QueryOperation): PgSession | undefined {
    return operation.#session;
  }
  static getSession(operation: QueryOperation): PgSession {
    return operation.#getSession();
  }
  static transferSession(operation: QueryOperation): PgSession {
    operation.#transferWriter();
    const session = operation.#getSession();
    operation.#session = undefined;
    const onFinished = operation.#onFinished;
    if (onFinished) {
      session.off("close", onFinished);
      onFinished();
    }
    const onError = operation.#onError;
    if (onError) session.off("error", onError);
    return session;
  }
}
