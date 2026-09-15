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
import type { SqlStatement, SqlStatements, TypedSqlStatement } from "./QueryStatement.ts";

export class QueryImpl implements ExtendedQueryOperation, SampleQueryOperation, CopyQueryOperation, TransactionQuery {
  begin(mode?: TransactionMode): Transaction {
  }

  open<T>(queryable: SqlStatement<T>, options?: OpenCursorOptions): PgCursor<T> {
  }
  query<T>(queryable: SqlStatement<T>, options?: QueryOptions): QueryReader<T> {
  }
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array> {
  }
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: unknown, options?: unknown): AsyncIterable<SampleQueryReader<unknown>> {
  }

  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle {
  }
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array> {
  }
}
