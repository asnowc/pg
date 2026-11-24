import type {
  Cursor as ICursor,
  CursorOpenOptions,
  CursorQueryOperation,
  MultipleQueryOperation,
  MultipleQueryReader,
  QueryOptions,
  QueryReader as IQueryReader,
  SingleQueryOperation,
  SqlStatement,
  SqlStatements,
  Transaction as ITransaction,
  TransactionMode,
  TransactionQueryOperation,
} from "@/interface/Query.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import Transaction from "./private/Transaction.ts";
import { HandleUnavailableError } from "@/_utils/error.ts";
import { isolationQuery } from "@/class/private/QueryFunction.ts";
import Cursor from "@/class/private/Cursor.ts";

export class QueryOperation
  implements MultipleQueryOperation, SingleQueryOperation, CursorQueryOperation, TransactionQueryOperation
{
  constructor(getSession: () => PgSession | Promise<PgSession>) {
    this.#getSessionWriter = () => {
      if (this.#writeLocked) throw new HandleUnavailableError("Session is locked");
      return getSession();
    };
  }

  #writeLocked = false;
  #transferWriter = () => {
    const writer = this.#getSessionWriter();
    this.#writeLocked = true;
    return writer;
  };
  #getSessionWriter: () => PgSession | Promise<PgSession>;
  #releaseWriter = () => {
    this.#writeLocked = false;
  };

  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): IQueryReader<T> {
    return isolationQuery(this.#getSessionWriter, queryable, options);
  }

  begin(mode?: TransactionMode): ITransaction {
    return new Transaction(this.#transferWriter, this.#releaseWriter, mode);
  }
  open<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: CursorOpenOptions & QueryOptionsWithDecoder,
  ): ICursor<T> {
    return new Cursor<T>(this.#transferWriter, this.#releaseWriter, queryable, options);
  }

  queryMultiple<T extends any[] = unknown[]>(
    queryable: SqlStatements,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): MultipleQueryReader<T> {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    throw new Error("Not implemented");
  }
  static isLocked(operation: QueryOperation): boolean {
    return operation.#writeLocked;
  }
}
export class ConnQueryOperation extends QueryOperation {
  constructor(session: PgSession, onFinished?: () => void, onError?: () => void) {
    super(() => this.#getSession());
    this.#session = session;
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
    if (!this.#session) throw new HandleUnavailableError("Session is not available");
    return this.#session;
  }
  static getSessionSafe(operation: ConnQueryOperation): PgSession | undefined {
    return operation.#session;
  }
  static getSession(operation: ConnQueryOperation): PgSession {
    return operation.#getSession();
  }
  static transferSession(operation: ConnQueryOperation): PgSession {
    const session = operation.#getSession();
    if (QueryOperation.isLocked(operation)) throw new HandleUnavailableError("Session is locked");
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
