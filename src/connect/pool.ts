import { ResourcePool } from "@/lib/pool.ts";
import type { PgConnection, PgPool, PgPoolConnection } from "./PgConnection.ts";
import { PgPoolImpl } from "@/connect/pool_impl.ts";
import { QueryImpl } from "@/query/QueryImpl.ts";

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
export class Pool2 extends QueryImpl implements PgPool {
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
  #get(): Promise<PgPoolConnection> {
    return this.#pool.get().then((conn) => {
      return conn as PgPoolConnection;
    });
  }
  connect(): Promise<PgPoolConnection> {
    return this.#pool.get().then((conn) => {
      return conn as PgPoolConnection;
    });
  }
}
function closeConnection(conn: PgConnection) {
  conn.close().catch(() => {});
}
