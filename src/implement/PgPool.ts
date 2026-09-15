import { ResourcePool } from "@/lib/pool.ts";
import type { PgConnection, PgPool as IPgPool, PgPoolConnection } from "@/interface/Connection.ts";
import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyToOptions,
  QueryOptions,
  QueryReader,
  SampleQueryReader,
  SqlStatement,
  SqlStatements,
  StatementEncoder,
  Transaction,
  TransactionMode,
} from "../interface/Query.ts";
import QueryReaderImpl from "@/implement/QueryReader.ts";
import type { PgMessageReader } from "@/protocol.ts";
/**
 * 原生连接池配置。建连和认证由调用方注入 。
 *  @public
 */
export interface CreatePoolOptions {
  /** 每次调用必须返回一个新的、已经完成认证的连接。 */
  create: () => Promise<PgConnection>;
  /** 最大连接数，默认 3。必须是正整数。 */
  maxCount?: number;
  /** 空闲回收时间（毫秒），默认 0（不回收）。 */
  idleTimeout?: number;
  /** 每个物理连接最多借用次数，默认 0（无限制）。 */
  usageLimit?: number;
  /** 创建连接失败时的重试次数，默认 0（不重试）。 */
  createRetry?: number;
}

export default class PgPool implements IPgPool {
  #pool: ResourcePool<PgConnection>;
  constructor(options: CreatePoolOptions) {
    checkOptions(options);
    this.#pool = new ResourcePool({
      create: options.create,
      dispose: closeConnection,
    }, {
      idleTimeout: options.idleTimeout,
      maxCount: options.maxCount,
      usageLimit: options.usageLimit,
      createRetry: options.createRetry,
    });
  }
  get idleCount(): number {
    return this.#pool.idleCount;
  }
  get totalCount(): number {
    return this.#pool.totalCount;
  }
  #getReader = (): Promise<PgMessageReader> => {
    return this.#pool.get().then((conn) => {
    });
  };
  connect(): Promise<PgPoolConnection> {
    return this.#pool.get().then((conn) => {
      return conn as PgPoolConnection;
    });
  }
  begin(mode?: TransactionMode): Transaction {
  }
  close(): Promise<void> {
  }
  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle {
  }
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array> {
  }
  query<T>(queryable: SqlStatement<T>, options?: QueryOptions): QueryReader<T> {
    const statement: StatementEncoder = queryable;
    return new QueryReaderImpl<T>(this.#getReader, statement);
  }
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array> {
  }
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: unknown, options?: unknown): AsyncIterable<SampleQueryReader<unknown>> {
  }
}
function checkOptions(options: CreatePoolOptions) {
  if (options.maxCount !== undefined && (!Number.isSafeInteger(options.maxCount) || options.maxCount <= 0)) {
    throw new RangeError("maxCount must be a positive integer");
  }
  if (options.usageLimit !== undefined && (!Number.isSafeInteger(options.usageLimit) || options.usageLimit < 0)) {
    throw new RangeError("usageLimit must be a non-negative integer");
  }
  if (options.idleTimeout !== undefined && (!Number.isFinite(options.idleTimeout) || options.idleTimeout < 0)) {
    throw new RangeError("idleTimeout must be non-negative and finite");
  }
}

function closeConnection(conn: PgConnection) {
  conn.close().catch(() => {});
}
