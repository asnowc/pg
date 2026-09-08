import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyToOptions,
  FieldInfo,
  OpenCursorOptions,
  PgCursor,
  Query,
  QueryCompletion,
  QueryOptions,
  QueryReader,
  SampleQueryReader,
  SqlStatementData,
  Transaction,
  TransactionMode,
  TypedSqlStatement,
  TypedSqlStatementTemplate,
} from "@/query.ts";
import { QueryReaderImpl } from "@/query/QueryReaderImpl.ts";
import { ResourcePool } from "@/lib/pool.ts";
import type { PgConnection } from "./PgConnection.ts";

/** @public */
export interface PgPool extends Query, AsyncDisposable {
  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  connect(): Promise<PgPoolConnection>;

  get idleCount(): number;
  get totalCount(): number;

  /** 拒绝新的借用，等待已借出的资源归还及物理连接关闭。 */
  [Symbol.asyncDispose](): Promise<void>;
}

/** @public */
export interface PgPoolConnection extends Query, Disposable, AsyncDisposable {
  get released(): boolean;
  /** 幂等释放。现有操作结束后才实际归还连接；此后不再接受新操作。 */
  release(): void;
  [Symbol.dispose](): void;
}

/** 原生连接池配置。建连和认证由调用方注入，兼容 Deno 和 Node.js。 @public */
export interface CreatePoolOptions {
  /** 每次调用必须返回一个新的、已经完成认证的连接。 */
  create: () => Promise<PgConnection>;
  /** 最大连接数，默认 3。必须是正整数。 */
  maxCount?: number;
  /** 空闲回收时间（毫秒），默认 0（不回收）。 */
  idleTimeout?: number;
  /** 每个物理连接最多借用次数，默认 0（无限制）。 */
  usageLimit?: number;
}

/**
 * 创建惰性建连的原生连接池。池级查询自动归还连接；事务、游标和 COPY 必须结束或取消。
 * QueryReader 的行会先物化，再归还连接，因此延迟消费结果不会读取其他借用者的数据。
 * @public
 */
export function createPgPool(options: CreatePoolOptions): PgPool {
  if (typeof options?.create !== "function") throw new TypeError("create is required");
  if (options.maxCount !== undefined && (!Number.isSafeInteger(options.maxCount) || options.maxCount <= 0)) {
    throw new RangeError("maxCount must be a positive integer");
  }
  if (options.usageLimit !== undefined && (!Number.isSafeInteger(options.usageLimit) || options.usageLimit < 0)) {
    throw new RangeError("usageLimit must be a non-negative integer");
  }
  if (options.idleTimeout !== undefined && (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)) {
    throw new RangeError("idleTimeout must be non-negative and finite");
  }
  return new PgPoolImpl(options);
}

type Statement<T> = TypedSqlStatementTemplate<T> | TypedSqlStatement<T> | SqlStatementData;
type Statements = TypedSqlStatement<unknown> | SqlStatementData | ReadableStream<Uint8Array>;
interface Lease {
  connection: PgConnection;
  release(discard?: boolean): void;
}

// Readers are thenable: never resolve a Promise with a QueryReader itself.
function observed<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

class PoolReader<T> extends QueryReaderImpl<T> {
  override then(onfulfilled?: (value: void) => void, onrejected?: (reason: unknown) => void): void {
    this.getCompletion().then(() => onfulfilled?.(), onrejected);
  }
}

abstract class PoolQuery implements Query {
  protected abstract acquire(): Promise<Lease>;
  protected assertOpen(): void {}

  query<T>(statement: Statement<T>, options?: QueryOptions): QueryReader<T> {
    this.assertOpen();
    const lease = this.acquire();
    return new PoolReader(observed((async () => {
      const resource = await lease;
      try {
        const reader = resource.connection.query<T>(statement, options);
        // A supplied connection may consume protocol messages lazily. Completion alone
        // does not establish that rows and metadata have become independent of it.
        const rows = await reader.getRows();
        const fields = await reader.getFields();
        const completion = await reader.getCompletion();
        return { rows, fields, completion };
      } finally {
        resource.release();
      }
    })()));
  }

  simpleQuery(statement: Statements, options?: QueryOptions): AsyncIterable<SampleQueryReader> {
    this.assertOpen();
    const acquire = () => this.acquire();
    return (async function* () {
      const resource = await acquire();
      try {
        const results = statement instanceof ReadableStream
          ? resource.connection.simpleQuery(statement, options)
          : resource.connection.simpleQuery(statement, options);
        yield* results;
      } finally {
        resource.release();
      }
    })();
  }

  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array> {
    this.assertOpen();
    const lease = this.acquire();
    const chunks: Uint8Array[] = [];
    const finished = Promise.withResolvers<void>();
    let output!: ReadableStreamDefaultController<SampleQueryReader>;
    let input!: WritableStreamDefaultController;
    let running = false;
    let cancelled = false;
    let cancelReason: unknown;
    const release = async () => {
      try {
        (await lease).release();
      } catch {
        // Acquisition errors are reported on both sides below.
      } finally {
        finished.resolve();
      }
    };
    const cancel = async (reason?: unknown) => {
      cancelled = true;
      cancelReason = reason ?? new Error("Query stream cancelled");
      if (!running) {
        chunks.length = 0;
        await release();
      }
      await finished.promise;
    };
    const readable = new ReadableStream<SampleQueryReader>({
      start(controller) {
        output = controller;
      },
      cancel(reason) {
        input.error(reason);
        return cancel(reason);
      },
    });
    const writable = new WritableStream<Uint8Array>({
      start(controller) {
        input = controller;
      },
      write(chunk) {
        chunks.push(chunk.slice());
      },
      async close() {
        running = true;
        try {
          const resource = await lease;
          if (cancelled) throw cancelReason;
          for await (const result of resource.connection.simpleQuery(chunks, options)) {
            if (cancelled) break;
            output.enqueue(result);
          }
          if (cancelled) throw cancelReason;
          output.close();
        } catch (error) {
          output.error(error);
          throw error;
        } finally {
          chunks.length = 0;
          await release();
        }
      },
      abort(reason) {
        output.error(reason);
        return cancel(reason);
      },
    });
    observed(lease.catch((error) => {
      input.error(error);
      output.error(error);
      finished.resolve();
    }));
    return { readable, writable };
  }

  openCursor<T>(statement: Statement<T>, options?: OpenCursorOptions): PgCursor<T> {
    this.assertOpen();
    return new PoolCursor(this.acquire(), statement, options);
  }

  begin(mode?: TransactionMode): Transaction {
    this.assertOpen();
    return new PoolTransaction(() => this.acquire(), mode);
  }

  copyFrom(statement: Statement<unknown>, options?: CopyFromOptions): CopyFromHandle {
    this.assertOpen();
    return new PoolCopyFrom(this.acquire(), statement, options);
  }

  copyTo(statement: Statement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array> {
    this.assertOpen();
    const lease = this.acquire();
    let resource: Lease | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let cancelled = false;
    const ready = observed(lease.then((value) => {
      resource = value;
      try {
        reader = resource.connection.copyTo(statement, options).getReader();
      } catch (error) {
        resource.release(true);
        throw error;
      }
    }));
    return new ReadableStream<Uint8Array>({
      start: () => ready,
      async pull(controller) {
        try {
          const result = await reader!.read();
          if (cancelled) return;
          if (result.done) {
            reader!.releaseLock();
            resource!.release();
            controller.close();
          } else controller.enqueue(result.value);
        } catch (error) {
          resource!.release(true);
          controller.error(error);
        }
      },
      async cancel(reason) {
        cancelled = true;
        // Native COPY cancellation may return before ReadyForQuery is drained.
        // Retire that connection rather than hand an unfinished exchange to a waiter.
        try {
          await ready;
          await reader?.cancel(reason);
        } finally {
          resource?.release(true);
          reader?.releaseLock();
        }
      },
    });
  }
}

class PgPoolImpl extends PoolQuery implements PgPool {
  private readonly resources: ResourcePool<PgConnection>;
  readonly #disposing = new Set<Promise<void>>();
  readonly #disposeErrors: unknown[] = [];
  #closePromise?: Promise<void>;
  constructor(options: CreatePoolOptions) {
    super();
    this.resources = new ResourcePool({
      create: options.create,
      dispose: (connection) => this.#disposeConnection(connection),
    }, options);
  }
  #disposeConnection(connection: PgConnection): void {
    let pending: Promise<void>;
    try {
      pending = connection[Symbol.asyncDispose]();
    } catch (error) {
      this.#disposeErrors.push(error);
      return;
    }
    this.#disposing.add(pending);
    pending.catch((error) => {
      this.#disposeErrors.push(error);
    }).finally(() => {
      this.#disposing.delete(pending);
    });
  }
  protected override assertOpen(): void {
    if (this.resources.closed) throw new Error("PgPool is closed");
  }
  protected async acquire(): Promise<Lease> {
    const connection = await this.resources.get();
    if (connection.closed) {
      this.resources.remove(connection);
      // A faulty factory must not cause an unbounded reconnect loop.
      throw new Error("Cannot borrow a closed PgConnection");
    }
    let released = false;
    return {
      connection,
      release: (discard = false) => {
        if (released) return;
        released = true;
        if (discard || connection.closed) this.resources.remove(connection);
        else this.resources.release(connection);
      },
    };
  }
  async connect(): Promise<PgPoolConnection> {
    return new PgPoolConnectionImpl(await this.acquire());
  }
  get idleCount(): number {
    return this.resources.idleCount;
  }
  get totalCount(): number {
    return this.resources.totalCount;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.#closePromise ??= this.#close();
  }
  async #close(): Promise<void> {
    await this.resources.close();
    await Promise.allSettled(this.#disposing);
    if (this.#disposeErrors.length) {
      throw new AggregateError(this.#disposeErrors, "PgConnection disposal failed");
    }
  }
}

class PgPoolConnectionImpl extends PoolQuery implements PgPoolConnection {
  #released = false;
  #active = 0;
  #discard = false;
  #done = Promise.withResolvers<void>();
  constructor(private readonly lease: Lease) {
    super();
  }
  get released(): boolean {
    return this.#released;
  }
  protected override assertOpen(): void {
    if (this.#released) throw new Error("PgPoolConnection is released");
    if (this.#discard || this.lease.connection.closed) throw new Error("PgPoolConnection is invalid");
  }
  protected acquire(): Promise<Lease> {
    this.assertOpen();
    this.#active++;
    let released = false;
    return Promise.resolve({
      connection: this.lease.connection,
      release: (discard = false) => {
        if (released) return;
        released = true;
        this.#discard ||= discard;
        this.#active--;
        this.#finish();
      },
    });
  }
  #finish(): void {
    if (!this.#released || this.#active) return;
    this.lease.release(this.#discard);
    this.#done.resolve();
  }
  release(): void {
    this.#released = true;
    this.#finish();
  }
  [Symbol.dispose](): void {
    this.release();
  }
  [Symbol.asyncDispose](): Promise<void> {
    this.release();
    return this.#done.promise;
  }
}

class PoolCursor<T> implements PgCursor<T> {
  #cursor?: PgCursor<T>;
  #failed = false;
  #ready: Promise<PgCursor<T>>;
  #closing?: Promise<void>;
  readonly completion: Promise<QueryCompletion>;
  readonly fields: Promise<readonly Readonly<FieldInfo>[]>;
  constructor(lease: Promise<Lease>, statement: Statement<T>, options?: OpenCursorOptions) {
    this.#ready = observed(lease.then((resource) => {
      try {
        const cursor = this.#cursor = resource.connection.openCursor<T>(statement, options);
        observed(cursor.fields);
        observed(cursor.completion.then(() => resource.release(), () => resource.release(true)));
        return cursor;
      } catch (error) {
        resource.release(true);
        throw error;
      }
    }));
    this.fields = observed(this.#ready.then((cursor) => cursor.fields));
    this.completion = observed(this.#ready.then((cursor) => cursor.completion));
    this.completion.catch(() => {
      this.#failed = true;
    });
  }
  get rowsRead(): number {
    return this.#cursor?.rowsRead ?? 0;
  }
  get isClosed(): boolean {
    return this.#failed || (this.#cursor?.isClosed ?? false);
  }
  async read(maxRows?: number): Promise<T[]> {
    return (await this.#ready).read(maxRows);
  }
  close(): Promise<void> {
    return this.#closing ??= this.#ready.then(async (cursor) => {
      await cursor.close();
      await this.completion;
    });
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    try {
      while (!this.isClosed) {
        const rows = await this.read();
        if (!rows.length) break;
        yield* rows;
      }
    } finally {
      await this.close();
    }
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

class PoolCopyFrom implements CopyFromHandle {
  #ready: Promise<CopyFromHandle>;
  #failure = Promise.withResolvers<never>();
  #ended = false;
  readonly complete: Promise<{ rows: number }>;
  readonly writable: WritableStream<Uint8Array>;
  constructor(lease: Promise<Lease>, statement: Statement<unknown>, options?: CopyFromOptions) {
    this.#ready = observed(lease.then((resource) => {
      try {
        return resource.connection.copyFrom(statement, options);
      } catch (error) {
        resource.release(true);
        throw error;
      }
    }));
    const ready = this.#ready;
    const failure = observed(this.#failure.promise);
    this.complete = observed((async () => {
      const resource = await lease;
      let discard = false;
      try {
        return await Promise.race([(await ready).complete, failure]);
      } catch (error) {
        discard = true;
        throw error;
      } finally {
        this.#ended = true;
        resource.release(discard);
      }
    })());
    this.writable = new WritableStream({
      write: (chunk) => this.write(chunk),
      close: () => this.closeWrite().then(() => undefined),
      abort: (reason) => this.abort(reason),
    });
  }
  async write(chunk: Uint8Array): Promise<void> {
    if (this.#ended) throw new Error("COPY input is closed");
    try {
      await (await this.#ready).write(chunk);
    } catch (error) {
      this.#fail(error);
      throw error;
    }
  }
  async closeWrite(): Promise<{ rows: number }> {
    if (!this.#ended) {
      this.#ended = true;
      try {
        await (await this.#ready).closeWrite();
      } catch (error) {
        this.#fail(error);
        throw error;
      }
    }
    return this.complete;
  }
  async abort(reason?: unknown): Promise<void> {
    if (!this.#ended) {
      this.#ended = true;
      try {
        await (await this.#ready).abort(reason);
      } catch (error) {
        this.#failure.reject(error);
        throw error;
      }
    }
    await this.complete.catch(() => undefined);
  }
  #fail(error: unknown): void {
    this.#failure.reject(error);
    // Some transports reject a write before their completion promise settles.
    // Do not leave pool waiters dependent on that completion promise.
    observed(this.#ready.then((copy) => copy.abort(error)));
  }
}

class PoolTransaction extends PoolQuery implements Transaction {
  readonly mode: TransactionMode;
  #lease?: Promise<Lease>;
  #released = false;
  #discard = false;
  #ending?: Promise<void>;
  #active = new Set<Promise<void>>();
  #cursors = new Set<PgCursor<unknown>>();
  constructor(private readonly borrow: () => Promise<Lease>, mode: TransactionMode = "READ COMMITTED") {
    super();
    if (!["SERIALIZABLE", "REPEATABLE READ", "READ COMMITTED", "READ UNCOMMITTED"].includes(mode)) {
      throw new TypeError("Invalid transaction mode");
    }
    this.mode = mode;
  }
  get released(): boolean {
    return this.#released;
  }
  protected override assertOpen(): void {
    if (this.#released) throw new Error("Transaction is released");
  }
  protected acquire(): Promise<Lease> {
    this.assertOpen();
    this.#lease ??= observed(
      this.borrow().then(async (resource) => {
        try {
          await resource.connection.query(`BEGIN ISOLATION LEVEL ${this.mode}`).getCompletion();
          return resource;
        } catch (error) {
          resource.release(true);
          throw error;
        }
      }),
    );
    const done = Promise.withResolvers<void>();
    this.#active.add(done.promise);
    return this.#lease.then((resource) => ({
      connection: resource.connection,
      release: (discard = false) => {
        this.#discard ||= discard;
        this.#active.delete(done.promise);
        done.resolve();
      },
    }), (error) => {
      this.#active.delete(done.promise);
      done.resolve();
      throw error;
    });
  }
  override openCursor<T>(statement: Statement<T>, options?: OpenCursorOptions): PgCursor<T> {
    const cursor = super.openCursor(statement, options);
    this.#cursors.add(cursor);
    observed(cursor.completion.finally(() => this.#cursors.delete(cursor)));
    return cursor;
  }
  async savePoint(name: string): Promise<void> {
    await this.query(`SAVEPOINT ${quoteIdentifier(name)}`).getCompletion();
  }
  async rollbackTo(name: string): Promise<void> {
    await this.query(`ROLLBACK TO SAVEPOINT ${quoteIdentifier(name)}`).getCompletion();
  }
  commit(): Promise<void> {
    return this.#end("COMMIT");
  }
  rollback(): Promise<void> {
    return this.#end("ROLLBACK");
  }
  #end(command: "COMMIT" | "ROLLBACK"): Promise<void> {
    if (this.#ending) return this.#ending;
    this.#released = true;
    return this.#ending = (async () => {
      if (!this.#lease) return;
      const resource = await this.#lease;
      let discard = false;
      try {
        await Promise.all(Array.from(this.#cursors, (cursor) => cursor.close()));
        await Promise.all(this.#active);
        await resource.connection.query(command).getCompletion();
      } catch (error) {
        discard = true;
        throw error;
      } finally {
        resource.release(discard || this.#discard);
      }
    })();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.rollback();
  }
}

function quoteIdentifier(value: string): string {
  if (!value || value.includes("\0")) throw new TypeError("Invalid savepoint name");
  return `"${value.replaceAll('"', '""')}"`;
}
