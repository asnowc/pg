import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyToOptions,
  OpenCursorOptions,
  Query,
  QueryOptions,
  Transaction,
  TransactionMode,
} from "./Query.ts";
import type { PgCursor, QueryReader, SampleQueryReader } from "./QueryReader.ts";
import type { SqlStatementData, TypedSqlStatement, TypedSqlStatementTemplate } from "./QueryStatement.ts";

export class QueryImpl implements Query {
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

  openCursor<T>(
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
