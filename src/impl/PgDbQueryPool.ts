import { PgCursor } from "./_PgCursor.ts";
import {
  DbCursor,
  DbCursorOption,
  DbPoolConnection,
  DbPoolTransaction,
  DbQueryPool,
  DbTransaction,
  MultipleQueryInput,
  MultipleQueryResult,
  QueryInput,
  SqlLike,
  TransactionMode,
} from "@asla/yoursql/client";
import { createPgClient } from "./_pg_client.ts";
import { ResourcePool } from "../lib/pool.ts";
import { PgConnection } from "./_PgConnection.ts";
import { DbConnectOption, parserDbConnectUrl } from "./connect.ts";
import { Client, Cursor } from "../driver/mod.js";
/** @public */
export class PgDbQueryPool extends DbQueryPool implements AsyncDisposable {
  #pool: ResourcePool<Client>;
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
    return new ResourcePool<Client>({
      create: async () => {
        const pool = this.#pool;
        const pgClient = createPgClient(this.connectOption);
        pgClient.on("end", () => pool.remove(pgClient));
        pgClient.on("error", () => pool.remove(pgClient));
        try {
          await pgClient.connect();
          return pgClient;
        } catch (error) {
          throw new Error("连接数据库失败", { cause: error });
        }
      },
      dispose: (conn) => {
        conn.end().catch((e) => {
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
    return new DbPoolConnection(
      new PgConnection(conn),
      () => this.#pool.release(conn),
      () => {
        conn.end().catch(() => {});
      },
    );
  }
  // implement
  override async query<T>(sql: QueryInput | MultipleQueryInput): Promise<T> {
    using conn = await this.connect();
    return await conn.query<T>(sql as any) as any;
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
    return new DbPoolTransaction(() => this.connect(), {
      mode,
      errorRollback: true,
    });
  }
  //implement
  async cursor<T extends object = any>(
    sql: SqlLike,
    option?: DbCursorOption,
  ): Promise<DbCursor<T>> {
    const conn = await this.#pool.get();
    const cursor = conn.query(new Cursor(sql.toString()));
    const poolConn = new DbPoolConnection(
      new PgConnection(conn),
      () => this.#pool.release(conn),
    );
    return new PgCursor(cursor, poolConn, option?.defaultSize);
  }
  close(force?: boolean) {
    return this.#pool.close(force);
  }
  /** 打开连接 */
  open() {
    if (this.#pool.closed) {
      this.#pool = this.#createPool();
    }
  }
  // implement
  [Symbol.asyncDispose](): PromiseLike<void> {
    return this.close();
  }
  /** 如果为 true, 则不会在创建新连接 */
  get closed() {
    return this.#pool.closed;
  }
  get totalCount() {
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
