// 外部 SQL 生成器相关接口

/**
 * @public
 * @deprecated 请改用 `TypedSqlStatementTemplate`。
 */
export interface SqlTemplate<T extends readonly any[] = readonly unknown[]> {
  readonly templates: readonly string[];
  readonly args: T;
  toTextArgs(): string[];
}

/**
 * @public
 * @deprecated 请改用 `TypedSqlStatement`。
 */
export interface SqlStatementDataset<T> {
  genSql(): string;
  /**
   * 仅用于类型推断，不应被调用
   */
  __infer(v: T): never;
}
