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
import QueryReaderImpl from "./QueryReader.ts";
import { Pool } from "@/_utils/ResourcePool.ts";

export class QueryOperation
  implements
    ExtendedQueryOperation,
    SampleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(private pool: Pool<PgSession>) {}
  begin(mode?: TransactionMode): Transaction {
    throw new Error("Not implemented");
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
  simpleQuery(queryable: unknown, options?: unknown): AsyncIterable<SampleQueryReader<unknown>> {
    throw new Error("Not implemented");
  }
}
