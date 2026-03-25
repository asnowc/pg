import { DbQuery, MultipleQueryInput, QueryDataInput, QueryInput } from "./DbQuery.ts";
import type { DbQueryBase, MultipleQueryResult, QueryRowsResult } from "./DbQueryBase.ts";
import { ConnectionNotAvailableError } from "./errors.ts";
import type { DbPoolConnection, SqlLike, TransactionMode } from "./interfaces.ts";

class DbPoolConnectionImpl extends DbQuery implements DbPoolConnection {
  constructor(
    conn: DbQueryBase,
    onRelease: (conn: DbQueryBase) => void,
    onDispose: (conn: DbQueryBase) => void = onRelease,
  ) {
    super();
    this.#conn = conn;
    this.#onRelease = onRelease;
    this.#onDispose = onDispose;
  }
  #onRelease: (conn: DbQueryBase) => void;
  #onDispose: (conn: DbQueryBase) => void;
  //implement
  async begin(mode?: TransactionMode): Promise<void> {
    await this.execute("BEGIN" + (mode ? " TRANSACTION ISOLATION LEVEL " + mode : ""));
  }
  #conn?: DbQueryBase;

  override query<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: MultipleQueryInput,
  ): Promise<T>;
  override query<T = any>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  override query<T = any>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  override query(sql: QueryInput | MultipleQueryInput): Promise<any> {
    if (!this.#conn) {
      return Promise.reject(new ConnectionNotAvailableError("Connection already release"));
    }
    if (typeof sql === "function") sql = sql();
    return this.#conn.query(sql);
  }
  override execute(sql: QueryInput | MultipleQueryInput): Promise<void> {
    if (!this.#conn) {
      return Promise.reject(new ConnectionNotAvailableError("Connection already release"));
    }
    if (typeof sql === "function") sql = sql();
    return this.#conn.execute(sql);
  }
  /** @deprecated 不建议使用 */
  override multipleQuery<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: SqlLike | SqlLike[],
  ): Promise<T> {
    if (!this.#conn) {
      return Promise.reject(new ConnectionNotAvailableError("Connection already release"));
    }
    return this.#conn.multipleQuery(sql);
  }

  //implement
  async rollback() {
    await this.execute("ROLLBACK");
  }
  //implement
  async commit() {
    await this.execute("COMMIT");
  }
  get released(): boolean {
    return !this.#conn;
  }
  /** 调用 release() 时，如果事务未提交，则抛出异常 */
  release() {
    const conn = this.#conn;
    if (conn) {
      this.#conn = undefined;
      this.#onRelease(conn);
    }
  }
  dispose() {
    const conn = this.#conn;
    if (conn) {
      this.#conn = undefined;
      this.#onDispose(conn);
    }
  }
  //implement
  [Symbol.dispose](): void {
    return this.release();
  }
}
/** @public */
export function createDbPoolConnection(
  conn: DbQueryBase,
  onRelease: (conn: DbQueryBase) => void,
  onDispose: (conn: DbQueryBase) => void = onRelease,
): DbPoolConnection {
  return new DbPoolConnectionImpl(conn, onRelease, onDispose);
}
