import type { PgConnection } from "./PgConnection.ts";
import type {
  FieldInfo,
  OpenCursorOptions,
  PgCursor,
  QueryCompletion,
  QueryOptions,
  QueryReader,
  SqlStatementData,
  Transaction,
  TransactionMode,
  TypedSqlStatement,
  TypedSqlStatementTemplate,
} from "../query.ts";
import { QueryReaderImpl } from "../query/QueryReaderImpl.ts";
import { PgTransactionStatus } from "../protocol/pg_message.ts";

type Statement<T> = TypedSqlStatementTemplate<T> | TypedSqlStatement<T> | SqlStatementData;

// The owning connection reserves its queue until release(), including rollback on disposal.
export class PgTransactionImpl implements Transaction {
  constructor(
    readonly mode: TransactionMode,
    private start: () => Promise<PgConnection>,
    private release: () => void,
  ) {}
  #connection?: Promise<PgConnection>;
  #ending?: Promise<void>;
  #pending = new Set<Promise<unknown>>();
  #cursors = new Set<TransactionCursor<unknown>>();

  get released(): boolean {
    return this.#ending !== undefined;
  }

  #getConnection(): Promise<PgConnection> {
    if (this.released) throw new Error("Transaction is released");
    return this.#connection ??= this.start();
  }

  #track<T>(promise: Promise<T>): Promise<T> {
    this.#pending.add(promise);
    promise.then(() => this.#pending.delete(promise), () => this.#pending.delete(promise));
    return promise;
  }

  query<T>(statement: Statement<T>, options?: QueryOptions): QueryReader<T> {
    const connection = this.#getConnection();
    return new QueryReaderImpl(this.#track(connection.then(async (conn) => {
      // Never return a thenable reader through a Promise: it would discard the rows.
      const reader = conn.query<T>(statement, options);
      const rows = await reader.getRows();
      return { rows, fields: await reader.getFields(), completion: await reader.getCompletion() };
    })));
  }

  openCursor<T>(statement: Statement<T>, options?: OpenCursorOptions): PgCursor<T> {
    const cursor = new TransactionCursor(this.#getConnection().then((conn) => conn.openCursor<T>(statement, options)));
    this.#cursors.add(cursor);
    cursor.completion.then(() => this.#cursors.delete(cursor), () => this.#cursors.delete(cursor));
    return cursor;
  }

  savePoint(name: string): Promise<void> {
    return this.query(`SAVEPOINT ${identifier(name)}`).getCompletion().then(() => undefined);
  }

  rollbackTo(name: string): Promise<void> {
    return this.query(`ROLLBACK TO SAVEPOINT ${identifier(name)}`).getCompletion().then(() => undefined);
  }

  commit(): Promise<void> {
    return this.#end(true);
  }

  rollback(): Promise<void> {
    return this.#end(false);
  }

  #end(commit: boolean): Promise<void> {
    return this.#ending ??= (async () => {
      try {
        if (!this.#connection) return;
        const conn = await this.#connection;
        await Promise.allSettled(Array.from(this.#cursors, (cursor) => cursor.close()));
        await Promise.allSettled(this.#pending);
        const aborted = conn.session.transactionStatus === PgTransactionStatus.Failed;
        await conn.query(commit && !aborted ? "COMMIT" : "ROLLBACK");
        if (commit && aborted) throw new Error("Cannot commit an aborted transaction; transaction was rolled back");
      } finally {
        this.release();
      }
    })();
  }

  async [Symbol.asyncDispose](): Promise<void> {
    // A previously awaited failing commit must not throw a second time during cleanup.
    if (!this.released) await this.rollback();
  }
}

class TransactionCursor<T> implements PgCursor<T> {
  constructor(private ready: Promise<PgCursor<T>>) {
    ready.then((cursor) => this.#cursor = cursor, () => undefined);
    this.fields = ready.then((cursor) => cursor.fields);
    this.completion = ready.then((cursor) => cursor.completion);
    this.fields.catch(() => undefined);
    this.completion.catch(() => undefined);
  }
  #cursor?: PgCursor<T>;
  #iteratorTaken = false;
  readonly fields: Promise<readonly Readonly<FieldInfo>[]>;
  readonly completion: Promise<QueryCompletion>;
  get rowsRead(): number {
    return this.#cursor?.rowsRead ?? 0;
  }
  get isClosed(): boolean {
    return this.#cursor?.isClosed ?? false;
  }
  async read(maxRows?: number): Promise<T[]> {
    if (this.#iteratorTaken) return [];
    return (await this.ready).read(maxRows);
  }
  async close(): Promise<void> {
    await (await this.ready).close();
  }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.#iteratorTaken) return (async function* () {})();
    this.#iteratorTaken = true;
    const ready = this.ready;
    return (async function* () {
      yield* await ready;
    })();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

function identifier(name: string): string {
  if (!name || name.includes("\0")) throw new TypeError("Savepoint name must be nonempty and contain no NUL");
  return `"${name.replaceAll('"', '""')}"`;
}
