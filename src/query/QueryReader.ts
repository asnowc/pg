import type { FieldInfo, QueryCompletion } from "./MessageData.ts";

/**
 * `QueryReader.getRows()`、`QueryReader.getFirstRow()`、`QueryReader.getMap()`、方法在一次查询后只能调用一次，重复调用将抛出异常
 *
 * @example
 *  //异步迭代器用法, 用于遍历查询结果。该方法通过 batch() 方法实现。
 *  for await (const item of query) {
 *    console.log(item);
 *  }
 */
export interface QueryReader<T = unknown> extends AsyncIterable<T> {
  /** 受影响的行数 */
  getRowCount(): Promise<number>;
  getCompletion(): Promise<Readonly<QueryCompletion>>;
  getFields(): Promise<readonly Readonly<FieldInfo>[]>;
  /**
   * 获取所有列
   * @param limit 限制从 PostgreSQL 服务端输出返回的最大行数。
   * @example
   * const rows = await query.getRows(10); // 获取最多 10 行数据
   */
  getRows(limit?: number): Promise<T[]>;
  /**
   * 只获取第一行数据
   * @returns 第一行数据，如果没有数据则返回 null。
   */
  getFirstRow(): Promise<T | null>;

  /**
   * 根据指定的字段名获取一个 Map，其中 key 为指定字段的值，value 为对应的行数据。
   * @param key 指定的字段名
   * @returns 返回一个 Map，其中 key 为指定字段的值，value 为对应的行数据。
   */
  getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>>;
  // reduce<R>(reducer: (accumulator: R, currentValue: T) => R, initialValue: R): Promise<R>;

  /**
   * 获取异步迭代器，用于遍历查询结果。
   * @example
   * for await (const item of query) {
   *   console.log(item);
   * }
   */
  [Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void>;
}
export interface DbCursor<T> extends AsyncDisposable, AsyncIterable<T> {
  /**
   * 记录已读取的行数。任何获取数据的方法都会更新该值。
   */
  get rowsRead(): number;

  /** 查询是否已关闭 */
  get isClosed(): boolean;
  /**
   * 提前关闭游标。重复关闭将被忽略。
   */
  close(): Promise<void>;
  read(maxRows?: number): Promise<T[]>;

  getFields(): Promise<readonly Readonly<FieldInfo>[]>;
  getCompletion(): Promise<QueryCompletion>;
}

export interface SampleQueryReader<T = unknown> {
  rowCount: number | null;
  get fields(): readonly Readonly<FieldInfo>[];
  get notices(): string[];
  get rows(): T[];
  [Symbol.iterator](): Iterator<T>;
}
