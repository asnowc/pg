import { PgCursor } from "./_PgCursor.ts";
import { createDbPoolConnection, createDbPoolTransaction, DbQueryPool, sqlLikeToString } from "#abstract";
import type {
  DbCursor,
  DbCursorOption,
  DbPoolConnection,
  DbTransaction,
  MultipleQueryInput,
  MultipleQueryResult,
  QueryInput,
  SqlLike,
  TransactionMode,
} from "#abstract";
import { createPgClient } from "./_pg_client.ts";
import { ResourcePool } from "../lib/pool.ts";
import { PgConnection } from "./_PgConnection.ts";
import { parserDbConnectUrl } from "./connect.ts";
import type { DbConnectOption } from "./connect.ts";
import type { PgConnection as NativePgConnection } from "../connect.ts";
/**
 * @public
 * @deprecated 请直接使用 `PgConnection`，或在应用层管理原生连接池。
 */
export class PgDbQueryPool extends DbQueryPool implements AsyncDisposable {
  #pool: ResourcePool<NativePgConnection>;
  constructor(url: URL | string | DbConnectOption | (() => URL | string | DbConnectOption)) {
    super();
    if (typeof url === "function") {
      this.#getConnectUrl = (): DbConnectOption => {
        return getConnectOption(url());
      };
    } else {
      this.#connectOption = getConnectOption(url);
    }
    this.#pool = this.#createPool();
  }
  #createPool() {
    return new ResourcePool<NativePgConnection>({
      create: async () => {
        return await createPgClient(this.connectOption);
      },
      dispose: (conn) => {
        conn[Symbol.asyncDispose]().catch((e) => {
          console.error("dispose pg driver connection error", e);
        });
      },
    }, { maxCount: 50, idleTimeout: 5000, usageLimit: 9999 });
  }
  #getConnectUrl?: () => DbConnectOption;
  #connectOption?: DbConnectOption;
  set connectOption(url: URL | string | DbConnectOption) {
    if (typeof url === "object" && !(url instanceof URL)) {
      this.#connectOption = url;
    } else {
      this.#connectOption = parserDbConnectUrl(url);
    }
  }
  get connectOption(): DbConnectOption {
    if (!this.#connectOption) {
      this.#connectOption = this.#getConnectUrl!();
    }
    return this.#connectOption;
  }
  // implement
  async connect(): Promise<DbPoolConnection> {
    const conn = await this.#pool.get();
    return createDbPoolConnection(
      new PgConnection(conn),
      () => conn.closed ? this.#pool.remove(conn) : this.#pool.release(conn),
      () => {
        this.#pool.remove(conn);
        conn[Symbol.asyncDispose]().catch(() => {});
      },
    );
  }
  // implement
  override async query<T>(sql: QueryInput | MultipleQueryInput): Promise<T> {
    using conn = await this.connect();
    const input = typeof sql === "function" ? sql() : sql;
    if (Array.isArray(input)) return await conn.query(input) as T;
    return await conn.query(input) as T;
  }
  // implement
  override async execute(sql: QueryInput | MultipleQueryInput): Promise<void> {
    using conn = await this.connect();
    return await conn.execute(sql);
  }
  // implement
  override async multipleQuery<
    T extends MultipleQueryResult = MultipleQueryResult,
  >(
    sql: SqlLike | SqlLike[],
  ): Promise<T> {
    using conn = await this.connect();
    return await conn.multipleQuery<T>(sql);
  }

  //implement
  begin(mode?: TransactionMode): DbTransaction {
    return createDbPoolTransaction(() => this.connect(), {
      mode,
      errorRollback: true,
    });
  }
  //implement
  async cursor<T extends object = Record<string, unknown>>(
    sql: SqlLike,
    option?: DbCursorOption,
  ): Promise<DbCursor<T>> {
    const conn = await this.#pool.get();
    const cursor = conn.openCursor<T>(sqlLikeToString(sql), { iteratorMaxRows: option?.defaultSize });
    const poolConn = createDbPoolConnection(
      new PgConnection(conn),
      () => conn.closed ? this.#pool.remove(conn) : this.#pool.release(conn),
      () => {
        this.#pool.remove(conn);
        conn[Symbol.asyncDispose]().catch(() => {});
      },
    );
    return new PgCursor(cursor, poolConn, option?.defaultSize);
  }
  close(force?: boolean): Promise<void> {
    return this.#pool.close(force);
  }
  /** 打开连接 */
  open(): void {
    if (this.#pool.closed) {
      this.#pool = this.#createPool();
    }
  }
  // implement
  [Symbol.asyncDispose](): PromiseLike<void> {
    return this.close();
  }
  /** 如果为 true, 则不会在创建新连接 */
  get closed(): boolean {
    return this.#pool.closed;
  }
  get totalCount(): number {
    return this.#pool.totalCount;
  }
  get idleCount(): number {
    return this.#pool.idleCount;
  }
}
function getConnectOption(
  url: URL | string | DbConnectOption,
): DbConnectOption {
  if (typeof url === "string" || url instanceof URL) {
    return parserDbConnectUrl(url);
  } else if (typeof url === "object") {
    return url;
  } else {
    throw new Error("无法解析的连接参数");
  }
}

/*
  pg 的一些行为
   PoolClient 重复 release() 会抛出异常
   Cursor 如果 close() 之后继续 read() ，会返回空数组
   Cursor read() 在回调前继续 read() , 回调函数会永远无法解决
*/
