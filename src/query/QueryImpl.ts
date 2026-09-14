import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyQueryOperation,
  CopyToOptions,
  ExtendedQueryOperation,
  OpenCursorOptions,
  QueryOptions,
  SampleQueryOperation,
  Transaction,
  TransactionMode,
  TransactionQuery,
} from "./Query.ts";
import type { PgCursor, QueryReader, SampleQueryReader } from "./QueryReader.ts";
import type { SqlStatementData, TypedSqlStatement, TypedSqlStatementTemplate } from "./QueryStatement.ts";

export class QueryImpl implements ExtendedQueryOperation, SampleQueryOperation, CopyQueryOperation, TransactionQuery {
  #pool;
  query<T>(
    queryable: SqlStatementData | TypedSqlStatementTemplate<T> | TypedSqlStatement<T>,
    options?: QueryOptions,
  ): QueryReader<T> {
  }
  begin(mode?: TransactionMode): Transaction {
  }
  close(): Promise<void> {
    return this.#pool.close();
  }
  copyFrom(
    queryable: SqlStatementData | TypedSqlStatement<unknown> | TypedSqlStatementTemplate<unknown>,
    options?: CopyFromOptions,
  ): CopyFromHandle {
  }
  copyTo(
    queryable: SqlStatementData | TypedSqlStatement<unknown> | TypedSqlStatementTemplate<unknown>,
    options?: CopyToOptions,
  ): ReadableStream<Uint8Array> {
  }

  open<T>(
    queryable: SqlStatementData | TypedSqlStatementTemplate<T> | TypedSqlStatement<T>,
    options?: OpenCursorOptions,
  ): PgCursor<T> {
  }
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array> {
  }
  simpleQuery(
    queryable: SqlStatementData | TypedSqlStatement<unknown>,
    options?: QueryOptions,
  ): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: unknown, options?: unknown): AsyncIterable<SampleQueryReader<unknown>> {
  }
}
