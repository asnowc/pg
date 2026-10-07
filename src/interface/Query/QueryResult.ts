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
