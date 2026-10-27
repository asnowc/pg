import type { QueryReader, SampleQueryReader } from "./QueryReader.ts";
import type { SqlStatement, SqlStatements, TypedSqlStatement } from "./QueryStatement.ts";
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
export interface SingleQueryOperation {
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
  query<T>(queryable: TypedSqlStatement<T> | SqlStatement, options?: QueryOptions): QueryReader<T>;
}
export interface PipelineQueryOperation {
  /**
   * 通过 Promise.all 执行流水线查询
   * 不能通过该方法开启事务。
   *
   * @param queryable 单条 SQL 语句。
   * @since 0.3.0
   * @example
   * ```ts
   * await Promise.all([
   *   conn.pipeline(sql).getRows(),
   *   conn.pipeline(sql).getRows(),
   * ]);
   * ```
   */
  pipeline<T>(queryable: TypedSqlStatement<T> | SqlStatement, options?: QueryOptions): QueryReader<T>;
}

/**
 * 支持简单查询的操作。
 *
 * @public
 * @since 0.3.0
 */
export interface MultipleQueryOperation {
  /**
   * 执行简单查询，并按 PostgreSQL 返回的每个结果集依次产生读取器。
   * 改方法执行结束后不能处于事务中，否则抛出异常
   * 改方法定义为独立的查询操作，不应依赖多个查询的上下文。
   *
   * @param queryable 一条或多条 SQL 语句。
   * @returns 按结果集顺序产生读取器的异步可迭代对象。
   * @since 0.3.0
   */
  queryMultiple(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader;
  /**
   * 从 SQL 字节流执行简单查询，并按 PostgreSQL 返回的每个结果集依次产生读取器。
   * 改方法执行结束后不能处于事务中，否则抛出异常
   * 改方法定义为独立的查询操作，不应依赖多个查询的上下文。
   *
   * @param queryable 提供一条或多条 SQL 语句的字节流。
   * @returns 按结果集顺序产生读取器的异步可迭代对象。
   * @since 0.3.0
   */
  queryMultiple(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader;
}
