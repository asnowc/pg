import { DbQuery, MultipleQueryInput, QueryDataInput, QueryInput } from "./DbQuery.ts";
import type { MultipleQueryResult, QueryRowsResult } from "./DbQueryBase.ts";
import { ConnectionNotAvailableError, ParallelQueryError } from "./errors.ts";
import type { DbPoolConnection, DbPoolTransaction, SqlLike, TransactionMode } from "./interfaces.ts";

/**
 * @public
 * @deprecated 旧事务适配 API 将在后续版本移除。
 */
export type DbPoolTransactionOption = {
  errorRollback?: boolean;
  mode?: TransactionMode;
};

class DbPoolTransactionImpl extends DbQuery implements DbPoolTransaction {
  #errorRollback?: boolean;
  readonly mode?: TransactionMode;
  readonly #begin: string;
  constructor(
    connect: () => Promise<DbPoolConnection>,
    option?: TransactionMode | DbPoolTransactionOption,
  ) {
    super();
    if (option) {
      if (typeof option === "string") this.mode = option;
      else {
        this.mode = option.mode;
        this.#errorRollback = option.errorRollback;
      }
    }
    this.#begin = "BEGIN" + (this.mode ? " TRANSACTION ISOLATION LEVEL " + this.mode : "");
    this.#connect = connect;
  }
  #connect: () => Promise<DbPoolConnection>;
  #conn?: DbPoolConnection;
  async commit(): Promise<void> {
    if (this.#conn) {
      const conn = this.#conn;
      const promise = conn.execute("COMMIT").then(
        () => conn.release(),
        (e) => conn.dispose(),
      );
      return promise;
    }
    this.#release(undefined);
  }
  async rollback(): Promise<void> {
    if (this.#conn) {
      const conn = this.#conn;
      const promise = conn.execute("ROLLBACK").then(
        () => conn.release(),
        (e) => conn.dispose(),
      );
      return promise;
    }
    this.#release(undefined);
  }

  savePoint(savePoint: string): Promise<void> {
    return this.execute("SAVEPOINT " + savePoint);
  }
  rollbackTo(savePoint: string): Promise<void> {
    return this.execute("ROLLBACK TO " + savePoint);
  }

  #pending?: Promise<unknown>;
  #getConnQuery<T>(
    call: (conn: DbPoolConnection) => Promise<T>,
    callIfFirst = call,
    queryErrorCatch?: (e: any) => never | Promise<never>,
  ): Promise<T> {
    if (this.#pending) {
      return Promise.reject(new ParallelQueryError());
    }
    if (this.#error) {
      return Promise.reject(this.#error);
    }

    let promise: Promise<T>;
    if (!this.#conn) {
      promise = this.#connect().then(
        (conn) => {
          if (this.released) {
            conn.release();
            throw this.#error;
          }
          this.#conn = conn;
          let promise = callIfFirst(conn);
          if (queryErrorCatch) {
            promise = promise.catch(queryErrorCatch);
          }
          return promise;
        },
        (e) => {
          this.#release(undefined);
          throw e;
        },
      );
    } else {
      promise = call(this.#conn);

      if (queryErrorCatch) {
        promise = promise.catch(queryErrorCatch);
      }
    }
    this.#pending = promise;

    return promise.finally(() => {
      this.#pending = undefined;
    });
  }
  #query<T>(
    call: (conn: DbPoolConnection) => Promise<T>,
    callIfFirst: (conn: DbPoolConnection) => Promise<T>,
  ): Promise<T> {
    const onError = (e: any) => {
      if (this.#errorRollback) {
        const passError = () => {
          throw e;
        };
        return this.rollback().then(passError, passError);
      } else {
        this.#release(this.#conn);
        throw e;
      }
    };
    return this.#getConnQuery(call, callIfFirst, onError);
  }

  override query<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: MultipleQueryInput,
  ): Promise<T>;
  override query<T extends object = any>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  override query<T extends object = any>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  override query(sql: QueryInput | MultipleQueryInput): Promise<any> {
    return this.#query(
      (conn): Promise<any> => {
        return conn.query(sql as any);
      },
      async (conn) => {
        if (typeof sql === "function") sql = sql();
        const isArray = sql instanceof Array;
        const result = await conn.query(
          isArray ? [this.#begin, ...(sql as any[])] : [this.#begin, sql],
        );
        if (isArray) return result.slice(1);
        else return result[1];
      },
    );
  }

  override async execute(sql: QueryInput | MultipleQueryInput): Promise<void> {
    return this.#query(
      (conn): Promise<any> => {
        return conn.execute(sql);
      },
      (conn) => {
        if (typeof sql === "function") sql = sql();
        return conn.execute(sql instanceof Array ? [this.#begin, ...sql] : [this.#begin, sql]);
      },
    );
  }
  /** @deprecated 不建议使用 */
  override multipleQuery<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: SqlLike | SqlLike[],
  ): Promise<T> {
    return this.#query(
      (conn): Promise<any> => {
        return conn.multipleQuery(sql);
      },
      (conn) => {
        return conn.multipleQuery(
          sql instanceof Array ? [this.#begin, ...sql] : [this.#begin, sql],
        );
      },
    );
  }

  #error: any;
  #release(
    conn: DbPoolConnection | undefined,
    error: any = new ConnectionNotAvailableError("Connection already release"),
  ) {
    this.#error = error;
    this.#conn = undefined;
    conn?.release();
  }
  get released(): boolean {
    return !!this.#error;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.rollback();
  }
}

/**
 * @public
 * @deprecated 旧事务适配 API 将在后续版本移除。
 */
export function createDbPoolTransaction(
  connect: () => Promise<DbPoolConnection>,
  option?: TransactionMode | DbPoolTransactionOption,
): DbPoolTransaction {
  return new DbPoolTransactionImpl(connect, option);
}
