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
export interface ExtendedQueryOperation {
  /**
   * 创建延迟执行的扩展查询。调用本方法不会立即向 PostgreSQL 发送请求；首次消费返回的 `QueryReader` 时才会执行查询。
   * 不能通过该方法开启事务。
   *
   * @param queryable 单条 SQL 语句。
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
}
export interface PipelineOperation {
  startPipeline(): ExtendedQueryOperation & { [Symbol.dispose](): void };
}
/**
 * 支持简单查询的操作。
 *
 * @public
 * @since 0.3.0
 */
export interface SampleQueryOperation {
  /**
   * 执行简单查询，并按 PostgreSQL 返回的每个结果集依次产生读取器。
   * 改方法执行结束后不能处于事务中，否则抛出异常
   * 改方法定义为独立的查询操作，不应依赖多个查询的上下文。
   *
   * @param queryable 一条或多条 SQL 语句。
   * @returns 按结果集顺序产生读取器的异步可迭代对象。
   * @since 0.3.0
   */
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader;
  /**
   * 从 SQL 字节流执行简单查询，并按 PostgreSQL 返回的每个结果集依次产生读取器。
   * 改方法执行结束后不能处于事务中，否则抛出异常
   * 改方法定义为独立的查询操作，不应依赖多个查询的上下文。
   *
   * @param queryable 提供一条或多条 SQL 语句的字节流。
   * @returns 按结果集顺序产生读取器的异步可迭代对象。
   * @since 0.3.0
   */
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader;
}

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
interface QueryReaderLink<T extends any[]> {
  query<U>(): QueryReaderLink<[...T, U]>;
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
export interface SampleQueryReader<T extends any[] = unknown[]> {
  then(onfulfilled?: (data: undefined) => void, onrejected?: (reason: unknown) => void): Promise<void>;
  last<R>(): Promise<R>;
  lastResults<T>(): Promise<QueryResult<T>>;
  all(): Promise<T[]>;
  allResults(): Promise<QueryResult<T[number]>[]>;
}
