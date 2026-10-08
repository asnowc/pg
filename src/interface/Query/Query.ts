import type { QueryCompletion, QueryResult } from "./QueryResult.ts";
import type { SqlStatement, SqlStatements, TypedSqlStatement, TypedSqlStatementEncoder } from "./QueryStatement.ts";
import type { QueryCommonOptions } from "./_internal.ts";

/**
 * 扩展查询的解码选项。
 *
 * @public
 * @since 0.3.0
 */
export type QueryOptions = QueryCommonOptions;

/**
 * 支持扩展查询的操作。
 *
 * @public
 * @since 0.3.0
 */
export type ExtendedQueryOperation = {
  /**
   * 创建延迟执行的扩展查询。调用本方法不会立即向 PostgreSQL 发送请求；首次消费返回的 `QueryReader` 时才会执行查询。
   * 池级查询入队后可与其他查询在同一连接上流水线执行；结果在对应的 `ReadyForQuery` 后返回。
   * 事务内查询在命令完成时返回，事务结束或同步点之前连接不会归还连接池。
   *
   * @param queryable 单条 SQL 语句；`Uint8Array[]` 表示同一条语句的多个分片。
   * @returns 用于读取本次查询结果的单次消费对象。
   * @since 0.3.0
   * @example
   * ```ts
   * await conn.query(sql); // 执行查询并忽略结果
   * const rows = await conn.query(sql).getRows();
   * ```
   */
  query<T>(
    queryable: SqlStatement<T>,
    options?: QueryOptions & Pick<TypedSqlStatement, "typeDecoders" | "columnDecoders">,
  ): QueryReader<T>;
  query<T>(queryable: TypedSqlStatementEncoder<T>, options?: QueryOptions): QueryReader<T>;
};
/**
 * 支持简单查询的操作。
 *
 * @public
 * @since 0.3.0
 */
export type SampleQueryOperation = {
  /**
   * 创建一个可写入 SQL 字节流并读取简单查询结果的双工流。
   *
   * @returns 写入 SQL 字节并读取查询结果的双工流。
   * @since 0.3.0
   */
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array>;

  /**
   * 执行简单查询，并按 PostgreSQL 返回的每个结果集依次产生读取器。
   * 当前仅支持字符串 SQL；非字符串输入会抛出 `TypeError`。结果会在 `ReadyForQuery` 后提供。
   * 若 SQL 将连接留在事务中，本库会回滚事务后抛出错误。
   *
   * @param queryable 一条或多条 SQL 语句；`Uint8Array[]` 可以表示 SQL 字节分片。
   * @returns 按结果集顺序产生读取器的异步可迭代对象。
   * @since 0.3.0
   */
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader;
  /**
   * 从 SQL 字节流执行简单查询，并按 PostgreSQL 返回的每个结果集依次产生读取器。
   * 当前版本不支持流输入，调用时抛出 `TypeError`。
   *
   * @param queryable 提供一条或多条 SQL 语句的字节流。
   * @returns 按结果集顺序产生读取器的异步可迭代对象。
   * @since 0.3.0
   */
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader;
};

/**
 * 延迟执行的扩展查询结果读取器。
 *
 * 一个读取器只对应一次查询执行。调用任何终结操作（包括 `await query`、结果读取方法或异步迭代）后，不能再次使用该读取器。
 * 不支持并发消费同一个读取器。
 *
 * @example
 * ```ts
 * const reader = conn.query(myStatement);
 * for await (const row of reader) {
 *   console.log(row);
 * }
 * ```
 *
 * @public
 * @since 0.3.0
 */
export interface QueryReader<T> extends AsyncIterable<T> {
  /**
   * 读取并返回所有结果行。
   *
   * @returns 本次查询返回的所有行。
   * @since 0.3.0
   */
  getRows(): Promise<T[]>;
  /**
   * 读取查询完成信息中的受影响行数。
   *
   * @returns PostgreSQL 报告的受影响行数。
   * @since 0.3.0
   */
  getRowCount(): Promise<number>;
  /**
   * 读取第一行结果。
   *
   * @returns 第一行；查询未返回任何行时为 `null`。
   * @since 0.3.0
   */
  getFirstRow(): Promise<T | null>;
  /**
   * 读取完整的查询结果，包括行、字段信息、通知和受影响行数。
   *
   * @returns 本次查询的完整结果。
   * @since 0.3.0
   */
  getResults(): Promise<QueryResult<T>>;
  /**
   * 以指定字段的值为键，读取所有行并构建映射。
   *
   * @param key 用作映射键的字段名。
   * @returns 键为字段值、值为对应行的 `Map`。
   * @since 0.3.0
   */
  getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>>;

  /**
   * 使读取器可被 `await`，执行查询并忽略结果行。
   *
   * @param onfulfilled 查询成功后的回调。
   * @param onrejected 查询失败后的回调。
   * @returns 查询完成后兑现的 Promise。
   * @since 0.3.0
   */
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void>;

  /**
   * 返回按行读取结果的异步迭代器。
   *
   * @returns 查询行，以及完成时的查询完成信息。
   * @since 0.3.0
   * @example
   * ```ts
   * for await (const row of query) {
   *   console.log(row);
   * }
   * ```
   */
  [Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void>;
}

/**
 * 简单查询返回的单个结果集的延迟读取器。
 * @example
 * ```ts
 * const reader = conn.simpleQuery(myStatement);
 * for await (const row of reader) {
 *   console.log(row);
 * }
 * ```
 *
 * @public
 * @since 0.3.0
 */
export interface SampleQueryReader<T extends any[] = unknown[]> extends AsyncIterable<QueryResult<T[number]>> {
  then(onfulfilled?: (data: undefined) => void, onrejected?: (reason: unknown) => void): Promise<void>;
  last<R>(): R;
  lastResult<T>(): QueryResult<T>;
  all(): T[];
}
