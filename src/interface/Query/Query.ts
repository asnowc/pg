import type { FieldInfo, QueryCompletion, QueryResult } from "./QueryResult.ts";
import type { QueryDecoder, SqlStatement, SqlStatements } from "./QueryStatement.ts";

type QueryCommonOptions = {
  onNotice?: (info: { notice: string }) => void;
};

/** @public */
export type QueryOptions = QueryCommonOptions & Pick<QueryDecoder<unknown>, "typeDecoders" | "columnDecoders">;

/** @public */
export type OpenCursorOptions = QueryCommonOptions & {
  /** 默认的 每次从 PostgreSQL 服务端获取的最大行数，用于控制批量读取的大小。 */
  iteratorMaxRows?: number;
};

/** @public */
export type ExtendedQueryOperation = {
  /**
   * @param queryable 只能是单条 SQL 语句，Uint8Array[] 表示单条 SQL 语句的分片
   * @example
   *   await conn.query(sql); // 执行单条 SQL 查询，忽略结果
   *   const rows=await conn.query(sql).getRows(); // 获取所有行数据
   *
   * @example 并发查询
   *  //下面在 最后一条 SQL执行后才会发送 Sync 消息
   *  const results = await Promise.all([
   *    conn.query(sql),
   *    conn.query(sql).getRowCount(),
   *    conn.query(sql).getRows(),
   *    conn.query(sql).getFirstRow(),
   *  ]);
   */
  query<T>(queryable: SqlStatement<T>, options?: QueryOptions): QueryReader<T>;
};
/** @public */
export type SampleQueryOperation = {
  /**
   * 从流中读取 SQL 并执行简单查询
   */
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array>;

  /**
   * @param queryable 只能可以是是多条 SQL 语句，Uint8Array[] 可以表示多条 SQL 语句的分片
   */
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
};

/**
 * `QueryReader.getRows()`、`QueryReader.getFirstRow()`、`QueryReader.getMap()`、方法在一次查询后只能调用一次，重复调用将抛出异常
 *
 * @example
 *  //异步迭代器用法, 用于遍历查询结果。该方法通过 batch() 方法实现。
 *  for await (const item of query) {
 *    console.log(item);
 *  }
 * @public
 */
export interface QueryReader<T> extends AsyncIterable<T> {
  /**
   * 获取所有列
   * @param limit 限制从 PostgreSQL 服务端输出返回的最大行数。
   * @example
   * const rows = await query.getRows(10); // 获取最多 10 行数据
   */
  getRows(): Promise<T[]>;
  /** 受影响的行数 */
  getRowCount(): Promise<number>;
  /**
   * 只获取第一行数据
   * @returns 第一行数据，如果没有数据则返回 null。
   */
  getFirstRow(): Promise<T | null>;
  results(): Promise<QueryResult<T>>;
  /**
   * 根据指定的字段名获取一个 Map，其中 key 为指定字段的值，value 为对应的行数据。
   * @param key 指定的字段名
   * @returns 返回一个 Map，其中 key 为指定字段的值，value 为对应的行数据。
   */
  getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>>;

  /** 等待查询完成，忽略行数据；不会消耗后续 getRows() 的读取机会。 */
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void>;

  /**
   * 获取异步迭代器，用于遍历查询结果。
   * @example
   * for await (const item of query) {
   *   console.log(item);
   * }
   */
  [Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void>;
}

/** @public */
export interface SampleQueryReader<T = unknown> {
  rowCount: number | null;
  get fields(): readonly Readonly<FieldInfo>[];
  get notices(): string[];
  get rows(): T[];
  [Symbol.iterator](): Iterator<T>;
}
