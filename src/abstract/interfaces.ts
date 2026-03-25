import type { DbQuery } from "./DbQuery.ts";
import type { DbCursor, DbCursorOption } from "./DbCursor.ts";
import type { SqlStatementDataset, SqlTemplate } from "./external.ts";

/**
 * 数据库连接
 * @public
 */
export interface DbConnection extends DbQuery, AsyncDisposable {
  close(): Promise<void>;
}

/**
 * 数据库池连接
 * @public
 */
export interface DbPoolConnection extends DbQuery, Disposable {
  release(): void;
  dispose(): void;
  begin(mode?: TransactionMode): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  get released(): boolean;
}

/** @public */
export type TransactionMode =
  | "SERIALIZABLE"
  | "REPEATABLE READ"
  | "READ COMMITTED"
  | "READ UNCOMMITTED";

/**
 * SQL 事务查询操作
 *
 * 使用 `await using` 语法离开作用域时，如果没有 `commit()` 或 `rollback(`) , 则调用 `rollback()`
 *
 * ```ts
 * async function doSomeTransaction(){
 *    await using transaction = pool.begin()
 *    await transaction.query("SELECT * FROM user")
 *    throw new Error("error")
 * }
 * try{
 *    await doSomeTransaction()
 * }catch(e){
 *    console.error(e)
 * }
 * ```
 * 下面的写法会造成连接池泄露
 * ```ts
 * async function doSomeTransaction(){
 *    const transaction = pool.begin()
 *    await transaction.query("SELECT * FROM user")
 * }
 * await doSomeTransaction() // 离开作用域后连接不会被回收
 * console.warn("连接未被回收！")
 *
 * ```
 * @public
 */
export interface DbTransaction extends DbQuery, AsyncDisposable {
  /** 回滚，并释放连接 */
  rollback(): Promise<void>;
  /** 回滚到保存点 */
  rollbackTo(savePoint: string): Promise<void>;
  savePoint(savePoint: string): Promise<void>;
  /** 提交，并释放连接 */
  commit(): Promise<void>;
}
/**
 * @public
 * 池连接事务
 */
export interface DbPoolTransaction extends DbTransaction {
  readonly mode?: TransactionMode;
  get released(): boolean;
}

/**
 * 数据库连接池
 * @public
 */
export interface DbPool {
  connect(): Promise<DbPoolConnection>;
  idleCount: number;
  totalCount: number;
  begin(mode?: TransactionMode): DbTransaction;
  cursor<T extends {}>(sql: SqlStatementDataset<T>): Promise<DbCursor<T>>;
  cursor<T>(sql: SqlLike, option?: DbCursorOption): Promise<DbCursor<T>>;
}

/** @public */
export type SqlLike = { genSql(): string } | SqlTemplate | string;
