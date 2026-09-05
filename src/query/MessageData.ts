export interface QueryCompletion {
  readonly status: "complete" | "closed";
  /** 受影响的行数 */
  readonly rowCount?: number;
  readonly fields: readonly Readonly<FieldInfo>[];
  readonly notices: string[];
}
export type FieldInfo = {
  /** 字段在本次查询返回的索引 */
  index: number;
  name: string;
  typeId: number;
  typeSize: number;
  typeModifier: number;
};
