import type { SqlStatement } from "./QueryStatement.ts";
import type { FieldInfo, QueryCompletion } from "./QueryResult.ts";
import type { QueryCommonOptions } from "./_internal.ts";
/** @public */
export type CursorOpenOptions = QueryCommonOptions & {
  /**
   * PostgreSQL 扩展查询协议中每次 `Execute` 消息使用的 `maxRows` 值。
   *
   * 必须为大于 `0` 的整数，服务端本次最多返回指定行数。
   * 该值只控制单次 `Execute`，不限制游标最终返回的总行数。
   * `read()` 未传入 `maxRows` 时使用此值。
   *
   * @throws {RangeError} 当值不是大于 `0` 的整数时抛出。
   * @defaultValue 由实现决定
   * @since 0.3.0
   */
  fetchSize?: number;
};

/** @public */
export type CursorQueryOperation = {
  /**
   * 打开一个服务端游标，以批量方式读取单条 SQL 查询的结果。
   *
   * 游标通过扩展查询协议的 `Execute.maxRows` 分批获取数据。游标本身不会限制查询结果的总行数。
   * 正常读取完全部结果后，游标会自动关闭；如果提前终止读取，应调用 `close()`，或使用 `await using` 管理资源。
   *
   * @param queryable 要执行的单条 SQL 语句。
   * @param options 游标读取和通知处理选项。
   * @returns 已打开的游标。
   *
   * @example
   * ```ts
   * await using cursor = await conn.open(myQueryStatement, { fetchSize: 100 });
   * for await (const row of cursor) {
   *   console.log(row);
   * }
   * ```
   */
  open<T>(queryable: SqlStatement<T>, options?: CursorOpenOptions): Promise<Cursor<T>>;
};
/** @public */
export interface Cursor<T> extends AsyncDisposable, AsyncIterable<T> {
  /**
   * 已从 PostgreSQL 服务端读取的行数。
   *
   * 该计数包含已预取但尚未由异步迭代器产出的行。
   */
  get rowsRead(): number;
  /**
   * 提前终止读取，关闭游标。
   *
   * 正常读取完全部结果后游标会自动关闭，此时无需调用此方法。重复调用会被忽略；游标关闭后不能继续读取。
   *
   * @returns 在游标关闭完成后兑现的 Promise，该 Promise 不会产生 Unhandled Promise Rejection。
   *
   * @example
   * ```ts
   * await using cursor = await conn.open(myQueryStatement);
   * const rows = await cursor.read(2);
   * console.log(rows);
   * // 不再需要剩余结果时提前关闭游标。
   * await cursor.close();
   * ```
   * @since 0.3.0
   */
  close(): Promise<void>;
  /**
   * 读取下一批行数据。
   *
   * 同一个游标不支持并发读取。异步迭代器开始读取后，不应同时调用此方法。
   * 当游标已读完时，返回空数组。
   *
   * @param maxRows 本次最多读取的行数，必须为大于 `0` 的整数。省略时使用游标的 `fetchSize`。
   * @returns 包含本次读取结果的数组；没有更多数据时返回空数组。
   * @throws {RangeError} 当 `maxRows` 不是大于 `0` 的整数时抛出。
   *
   * @example
   * ```ts
   * const rows = await cursor.read(100);
   * console.log(rows.length);
   * ```
   * @since 0.3.0
   */
  read(maxRows?: number): Promise<T[]>;

  /**
   * 获取查询结果的字段描述。
   *
   * 字段描述对应 PostgreSQL 扩展查询协议返回的 `RowDescription`。
   * 对于不返回行的查询，结果为空数组。
   *
   * @experimental
   * @since 0.3.0
   */
  get fields(): readonly Readonly<FieldInfo>[];

  /**
   * 获取查询完成信息。
   *
   * 该 Promise 不会产生 Unhandled Promise Rejection
   *
   * @experimental
   * @since 0.3.0
   */
  get completion(): Promise<QueryCompletion>;
}
