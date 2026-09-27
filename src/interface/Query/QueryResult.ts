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
  /** 受影响的行数 */
  readonly rowCount: number;
  readonly notices: string[];
  readonly rows: T[];
  readonly fields: readonly Readonly<FieldInfo>[];
}
