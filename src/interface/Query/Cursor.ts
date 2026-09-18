import type { SqlStatement } from "./QueryStatement.ts";
import type { FieldInfo, QueryCompletion } from "./QueryResult.ts";
type QueryCommonOptions = {
  onNotice?: (info: { notice: string }) => void;
};
/** @public */
export type CursorOpenOptions = QueryCommonOptions & {
  /** 默认的 每次从 PostgreSQL 服务端获取的最大行数，用于控制批量读取的大小。 */
  iteratorMaxRows?: number;
};

/** @public */
export type CursorQueryOperation = {
  /**
   * 提供接近 PostgreSQL 原生的高级查询接口
   */
  open<T>(queryable: SqlStatement<T>, options?: CursorOpenOptions): Cursor<T>;
};
/** @public */
export interface Cursor<T> extends AsyncDisposable, AsyncIterable<T> {
  /** 已从服务端读取的行数，包含迭代器预取批次中尚未产出的行。 */
  get rowsRead(): number;

  /** 查询是否已关闭 */
  get isClosed(): boolean;
  /**
   * 提前关闭游标。重复关闭将被忽略。
   */
  close(): Promise<void>;
  /** 不允许并发读取；迭代器取得读取权后返回空数组。 */
  read(maxRows?: number): Promise<T[]>;

  get fields(): Promise<readonly Readonly<FieldInfo>[]>;
  get completion(): Promise<QueryCompletion>;
}

/** @public */
export enum CursorStatus {
  Open = "opening",
  Closed = "closed",
  Completed = "completed",
}
