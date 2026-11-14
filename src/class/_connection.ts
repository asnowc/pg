import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyQueryOperation,
  CopyToOptions,
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
  Transaction,
  TransactionMode,
  TransactionQueryOperation,
} from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./private/sql_statement.ts";
import QueryReader from "./private/QueryReader.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { PgSession } from "@/protocol/PgSession.ts";

export type GetSession = (resolve: (session: PgSession) => void, reject: (error: unknown) => void) => void;

export class SessionRef {
  constructor(public session?: PgSession) {}
  getSession(): PgSession {
    if (!this.session) throw new Error("Session is already released");
    return this.session;
  }
  transferSession(): PgSession {
    const session = this.getSession();
    this.session = undefined;
    return session;
  }
}

export class QueryOperation
  implements
    MultipleQueryOperation,
    SingleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(private core: SessionRef) {
  }

  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): IQueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReader(() => {
      return new Promise((resolve) => {
        const session = this.core.getSession();
        const promise = session.queryWriter.extendedQuery<T>(encoder);
        session.queryWriter.sync();
        resolve(promise);
      });
    });
  }

  begin(mode?: TransactionMode): Transaction {
    throw new Error("Not implemented");
  }
  open<T>(queryable: SqlStatement | TypedSqlStatement<T>, options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }
  copyFrom(queryable: SqlStatement | TypedSqlStatement, options?: CopyFromOptions): CopyFromHandle {
    throw new Error("Not implemented");
  }
  copyTo(queryable: SqlStatement | TypedSqlStatement, options?: CopyToOptions): ReadableStream<Uint8Array> {
    throw new Error("Not implemented");
  }

  queryMultiple(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: unknown, _options?: unknown): SampleQueryReader {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    throw new Error("Not implemented");
  }
}
