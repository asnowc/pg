/** @public */
export interface QueryCompletion {
  /** 受影响的行数 */
  readonly rowCount?: number;
  readonly notices: string[];
}

/** @public */
export type FieldInfo = {
  /** 字段在本次查询返回的索引 */
  index: number;
  name: string;
  typeId: number;
  typeSize: number;
  typeModifier: number;
};

/** @public */
export interface QueryResult<T> {
  /** 受影响的行数 */
  readonly rowCount: number;
  readonly notices: string[];
  readonly rows: T[];
  readonly fields: readonly Readonly<FieldInfo>[];
}
