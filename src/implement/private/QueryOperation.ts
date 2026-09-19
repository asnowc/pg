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
} from "@/interface/Query.ts";
import { sqlStatementToSqlEncoder } from "./sql_statement.ts";
import QueryReaderImpl from "./QueryReader.ts";

export class QueryOperation
  implements
    ExtendedQueryOperation,
    SampleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(getSession: () => Promise<PgSession>, release: (session: PgSession) => void) {
    this.#getSession = getSession;
    this.#release = release;
  }
  #getSession: () => Promise<PgSession>;
  #release: (session: PgSession) => void;
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
  query<T>(queryable: SqlStatement<T>, options?: QueryOptions): QueryReader<T> {
    const encoder = sqlStatementToSqlEncoder(queryable);
    return new QueryReaderImpl<T>(this.#getSession, encoder, this.#release, options);
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
