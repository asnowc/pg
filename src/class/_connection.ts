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
  QueryReader,
  SampleQueryReader,
  SingleQueryOperation,
  SqlStatement,
  SqlStatements,
  Transaction,
  TransactionMode,
  TransactionQueryOperation,
} from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./private/sql_statement.ts";
import QueryReaderImpl from "./private/QueryReader.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import type { PgConnection } from "./PgConnection.ts";

export class QueryOperation
  implements
    MultipleQueryOperation,
    SingleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(getSession: () => PgSession) {
    this.#getSession = getSession;
  }
  #getSession: () => PgSession;
  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): QueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReaderImpl(() => {
      const promise = this.#getSession().queryWriter.extendedQuery<T>(encoder);
      this.#getSession().queryWriter.sync();
      return promise;
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
