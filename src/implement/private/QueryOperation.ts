import type { PgSession } from "@/protocol/PgSession.ts";
import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyQueryOperation,
  CopyToOptions,
  Cursor,
  CursorOpenOptions,
  CursorQueryOperation,
  ExtendedQueryOperation,
  QueryOptions,
  QueryReader,
  SampleQueryOperation,
  SampleQueryReader,
  SqlStatement,
  SqlStatements,
  Transaction,
  TransactionMode,
  TransactionQueryOperation,
  TypedSqlStatement,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { sqlStatementToSqlEncoder } from "./sql_statement.ts";
import QueryReaderImpl, { SessionHandle } from "./QueryReader.ts";
import { TransactionImpl } from "./TransactionImpl.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";

export class QueryOperation
  implements
    ExtendedQueryOperation,
    SampleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(private pool: SessionHandle) {}
  begin(mode?: TransactionMode): Transaction {
    return new TransactionImpl(this.pool, mode);
  }
  open<T>(queryable: SqlStatement<T>, options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }
  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle {
    throw new Error("Not implemented");
  }
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array> {
    throw new Error("Not implemented");
  }
  query<T>(
    queryable: SqlStatement<T> | TypedSqlStatementEncoder<T>,
    options?: QueryOptions & Pick<TypedSqlStatement, "typeDecoders" | "columnDecoders">,
  ): QueryReader<T> {
    const encoder = sqlStatementToSqlEncoder(queryable, options);
    return new QueryReaderImpl<T>(this.pool, encoder);
  }
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array> {
    throw new Error("Not implemented");
  }
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  async *simpleQuery(queryable: unknown, _options?: unknown): AsyncIterable<SampleQueryReader<unknown>> {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    const session = await this.pool.get();
    let results: Promise<import("@/protocol/parsers/QueryResultParser.ts").QueryResultParser[]>;
    try {
      results = session.simpleQuery(createTypeSqlStatementEncoder(queryable));
    } finally {
      this.pool.release(session);
    }
    for (const result of await results) {
      yield {
        rowCount: result.rowCount,
        fields: result.fields ?? [],
        notices: result.notices,
        rows: result.rows,
        [Symbol.iterator]: () => result.rows[Symbol.iterator](),
      };
    }
  }
}
