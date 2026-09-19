import { ResourcePool } from "@/_utils/ResourcePool.ts";
import type { PgSession } from "@/protocol.ts";
import type { ByteStream } from "@/interface/ByteStream.ts";
import type { PgPoolConnection as IPgPoolConnection } from "./PgPoolConnection.ts";
import { QueryOperation } from "./private/QueryOperation.ts";
import { connectFromByteStream } from "@/protocol/connect.ts";
import type { PgConnectOptions } from "@/interface/Connection.ts";
/**
 * 原生连接池配置。建连和认证由调用方注入 。
 *  @public
 */
export interface CreatePoolOptions {
  /** 每次调用必须返回一个新的、已经完成认证的连接。 */
  create: () => Promise<{ stream: ByteStream; connectOptions: PgConnectOptions }>;
  /** 最大连接数，默认 3。必须是正整数。 */
  maxCount?: number;
  /** 空闲回收时间（毫秒），默认 0（不回收）。 */
  idleTimeout?: number;
  /** 每个物理连接最多借用次数，默认 0（无限制）。 */
  usageLimit?: number;
  /** 创建连接失败时的重试次数，默认 0（不重试）。 */
  createRetry?: number;
}

/** @public */
export class PgPool extends QueryOperation implements AsyncDisposable {
  #pool: ResourcePool<PgSession>;
  /**
   * 创建惰性建连的原生连接池。池级查询自动归还连接；事务、游标和 COPY 必须结束或取消。
   * QueryReader 的行会先物化，再归还连接，因此延迟消费结果不会读取其他借用者的数据。
   * @public
   */
  constructor(options: CreatePoolOptions) {
    checkOptions(options);
    super(() => this.#pool.get(), (session) => this.#release(session));
    this.#pool = new ResourcePool({
      create: async () => {
        const { connectOptions, stream } = await options.create();
        return connectFromByteStream(stream, connectOptions);
      },
      dispose: closeByteStream,
    }, {
      idleTimeout: options.idleTimeout,
      maxCount: options.maxCount,
      usageLimit: options.usageLimit,
    });
  }

  /** 空闲连接数 */
  get idleCount(): number {
    return this.#pool.idleCount;
  }
  /** 总连接数 */
  get totalCount(): number {
    return this.#pool.totalCount;
  }

  #release(session: PgSession) {
    this.#pool.release(session);
  }
  /** 借用连接；必须 release() 或使用 using / await using 释放。 */
  connect(): Promise<IPgPoolConnection> {
    return this.#pool.get().then((session) => new PgPoolConnection(session, (session) => this.#release(session)));
  }
  get closed(): boolean {
    return this.#pool.closed;
  }
  /** 关闭连接池。关闭后不再接受新的连接请求。Promise 在所有连接关闭后完成。 */
  close(): Promise<void> {
    return this.#pool.close();
  }
  /** 销毁连接池，立即关闭所有连接并释放资源。 */
  destroy(): void {
    this.#pool.destroy();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
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

function closeByteStream(session: PgSession) {
  session.close().catch(() => {});
}

class PgPoolConnection extends QueryOperation implements IPgPoolConnection {
  constructor(session: PgSession, onRelease: (session: PgSession) => void) {
    super(() => Promise.resolve(session), onRelease);
    this.#release = onRelease;
    this.#session = session;
  }
  #session?: PgSession;
  #release: (session: PgSession) => void;
  release(): void {
    if (!this.#session) {
      return;
    }
    this.#release(this.#session);
    this.#session = undefined;
  }
  get released(): boolean {
    return !this.#session;
  }
  [Symbol.dispose]() {
    return this.release();
  }
}
