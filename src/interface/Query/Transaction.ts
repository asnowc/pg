import type { CursorQueryOperation } from "./Cursor.ts";
import type { ExtendedQueryOperation } from "./Query.ts";

/** @public */
export interface TransactionQueryOperation {
  /**
   * 创建独占连接的事务对象，并异步发送 `BEGIN`；结束事务后释放连接。
   *
   * @since 0.3.0
   */
  begin(mode?: TransactionMode): Transaction;
}
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
 * @since 0.3.0
 */
export interface Transaction extends ExtendedQueryOperation, CursorQueryOperation, AsyncDisposable {
  /** @since 0.3.0 */
  readonly mode: TransactionMode;
  /**
   * 回滚并在确认连接空闲后释放。
   * @since 0.3.0
   */
  rollback(): Promise<void>;
  /**
   * 在同步先前查询后回滚到保存点。
   * @since 0.3.0
   */
  rollbackTo(savePoint: string): Promise<void>;
  /** @since 0.3.0 */
  savePoint(savePoint: string): Promise<void>;
  /**
   * 提交并在确认连接空闲后释放。
   * @since 0.3.0
   */
  commit(): Promise<void>;
  /** @since 0.3.0 */
  get released(): boolean;
}
/**
 * @public
 * @since 0.3.0
 */
export type TransactionMode =
  | "SERIALIZABLE"
  | "REPEATABLE READ"
  | "READ COMMITTED"
  | "READ UNCOMMITTED";
