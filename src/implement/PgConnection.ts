import type { PgSession } from "@/protocol.ts";
import { PgConnection as IPgConnection, PgPoolConnection as IPgPoolConnection } from "@/interface/Connection.ts";
import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyQueryOperation,
  CopyToOptions,
  Cursor,
  CursorOpenOptions,
  CursorQueryOperation,
  MultipleQueryOperation,
  PipelineQueryOperation,
  QueryOptions,
  QueryReader,
  SampleQueryReader,
  SingleQueryOperation,
  SqlStatement,
  SqlStatements,
  Transaction,
  TransactionMode,
  TransactionQueryOperation,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { sqlStatementToSqlEncoder } from "./private/sql_statement.ts";
import QueryReaderImpl from "./private/QueryReader.ts";

class QueryOperation
  implements
    PipelineQueryOperation,
    MultipleQueryOperation,
    SingleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(session: PgSession) {
    this.#session = session;
  }

  #session: PgSession;
  query<T>(queryable: SqlStatement<T> | TypedSqlStatementEncoder<T>, options?: QueryOptions): QueryReader<T> {
    const encoder = sqlStatementToSqlEncoder(queryable, options);
    return new QueryReaderImpl(() => {
      const promise = this.#session.extendedQuery<T>(encoder);
      this.#session.sync();
      return promise;
    });
  }

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

  pipeline(queryable: unknown, options?: unknown): QueryReader<unknown> {
    throw new Error("Not implemented");
  }

  queryMultiple(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: unknown, _options?: unknown): SampleQueryReader {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    throw new Error("Not implemented");
  }
}

export class PgConnection extends QueryOperation implements IPgConnection {
  constructor(session: PgSession) {
    super(session);
    this.#session = session;
    this.finished = new Promise<void>((resolve, reject) => {
      this.#session.on("close", resolve);
      this.#session.on("error", reject);
    });
  }
  #session: PgSession;
  get processId(): number | null {
    return this.#session.processId;
  }
  get parameters(): Record<string, string> {
    return { ...this.#session.parameters };
  }
  get closed(): boolean {
    return this.#session.closed;
  }
  readonly finished: Promise<void>;
  close(): Promise<void> {
    return this.#session.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    return this.#session.destroy();
  }
}

export class PgPoolConnection extends QueryOperation implements IPgPoolConnection {
  constructor(session: PgSession, onRelease: (session: PgSession) => void) {
    super(session);
    this.#release = onRelease;
    this.#session = session;

    this.processId = session.processId;
  }
  #getSession() {
    if (!this.#session) throw new Error("PoolConnection is already released");
    const session = this.#session;
    this.#session = undefined;
    return session;
  }
  #session?: PgSession;
  #release?: (session: PgSession) => void;

  readonly processId: number | null;

  release(): void {
    if (!this.#release) return;
    const session = this.#getSession();
    const release = this.#release;
    this.#release = undefined;
    release(session);
  }
  get released(): boolean {
    return !this.#release;
  }
  get closed(): boolean {
    return !this.#session || this.#session.closed;
  }

  close(): Promise<void> {
    return this.#getSession().close();
  }
  destroy(): void {
    return this.#getSession().destroy();
  }

  [Symbol.dispose]() {
    return this.release();
  }
}
