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
  rows(): Promise<T[]>;
  /**
   * 读取查询完成信息中的受影响行数。
   *
   * @returns PostgreSQL 报告的受影响行数。
   * @since 0.3.0
   */
  rowCount(): Promise<number>;
  /**
   * 读取第一行结果。
   *
   * @returns 第一行；查询未返回任何行时为 `null`。
   * @since 0.3.0
   */
  firstRow(): Promise<T | null>;
  /**
   * 读取完整的查询结果，包括行、字段信息、通知和受影响行数。
   *
   * @returns 本次查询的完整结果。
   * @since 0.3.0
   */
  results(): Promise<QueryResult<T>>;
  /**
   * 以指定字段的值为键，读取所有行并构建映射。
   *
   * @param key 用作映射键的字段名。
   * @returns 键为字段值、值为对应行的 `Map`。
   * @since 0.3.0
   */
  map<K extends keyof T>(key: K): Promise<Map<T[K], T>>;

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
export interface SampleQueryReader<T extends any[] = unknown[]> {
  then(onfulfilled?: (data: undefined) => void, onrejected?: (reason: unknown) => void): Promise<void>;
  last<R>(): Promise<R>;
  lastResults<T>(): Promise<QueryResult<T>>;
  all(): Promise<T[]>;
  allResults(): Promise<QueryResult<T[number]>[]>;
}

/** @public */
export interface QueryCompletion {
  /** 受影响的行数 */
  readonly rowCount?: number;
  readonly notices: string[];
}

/** @public */
export type FieldInfo = {
  name: string;
  typeOID: number;
  typeSize: number;
  typeModifier: number;
};

/** @public */
export interface QueryResult<T> {
  /**
   * 当前结果集的受影响行数；结果尚未完成时为 `null`。
   *
   * @since 0.3.0
   */
  readonly rowCount: number | null;
  /**
   * PostgreSQL 在处理当前结果集时发出的通知。
   *
   * @since 0.3.0
   */
  readonly notices: string[];
  /**
   * 当前结果集已读取的行。
   *
   * @since 0.3.0
   */
  readonly rows: T[];
  /**
   * 当前结果集的字段元数据。
   *
   * @since 0.3.0
   */
  readonly fields: readonly Readonly<FieldInfo>[];
}
