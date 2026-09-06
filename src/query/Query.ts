import type { PgCursor, QueryReader, SampleQueryReader } from "./QueryReader.ts";
import type { SqlStatementData, TypedSqlStatement, TypedSqlStatementTemplate } from "./QueryStatement.ts";

type QueryCommonOptions = {
  onNotice?: (info: { notice: string }) => void;
};

/** @public */
export type QueryOptions = QueryCommonOptions & Pick<TypedSqlStatementTemplate, "typeDecoders" | "columnDecoders">;

/** @public */
export type OpenCursorOptions = QueryCommonOptions & {
  /** 默认的 每次从 PostgreSQL 服务端获取的最大行数，用于控制批量读取的大小。 */
  iteratorMaxRows?: number;
};

/** @public */
export type CopyFromOptions = QueryCommonOptions;

/** @public */
export type CopyToOptions = QueryCommonOptions;

/** @public */
export interface SingleQuery {
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
  /**
   * 提供接近 PostgreSQL 原生的高级查询接口
   */
  openCursor<T>(queryable: SqlStatement<T>, options?: OpenCursorOptions): PgCursor<T>;
}

/** @public */
export interface Query extends SingleQuery {
  /**
   * 从流中读取 SQL 并执行简单查询
   */
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array>;

  /**
   * @param queryable 只能可以是是多条 SQL 语句，Uint8Array[] 可以表示多条 SQL 语句的分片
   */
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;

  begin(mode?: TransactionMode): Transaction;

  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle;
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array>;
}

/**
 * 表示可以包含单条 SQL 语句的查询对象
 */
type SqlStatement<T> = TypedSqlStatementTemplate<T> | TypedSqlStatement<T> | SqlStatementData;
/**
 * 表示可以包含多条 SQL 语句的查询对象
 */
type SqlStatements = TypedSqlStatement<unknown> | SqlStatementData;

/** @public */
export interface CopyFromHandle {
  write(chunk: Uint8Array): Promise<void>;
  closeWrite(): Promise<{ rows: number }>;
  abort(reason?: unknown): Promise<void>;
  readonly writable: WritableStream<Uint8Array>;
  get complete(): Promise<{ rows: number }>;
}

/**
 * SQL 事务查询操作
 *
 * 使用 `await using` 语法离开作用域时，如果没有 `commit()` 或 `rollback(`) , 则调用 `rollback()`
 *
 * ```ts
 * async function doSomeTransaction(){
 *    await using transaction = pool.begin()
 *    await transaction.query("SELECT * FROM user")
 *    throw new Error("error")
 * }
 * try{
 *    await doSomeTransaction()
 * }catch(e){
 *    console.error(e)
 * }
 * ```
 * 下面的写法会造成连接池泄露
 * ```ts
 * async function doSomeTransaction(){
 *    const transaction = pool.begin()
 *    await transaction.query("SELECT * FROM user")
 * }
 * await doSomeTransaction() // 离开作用域后连接不会被回收
 * console.warn("连接未被回收！")
 *
 * ```
 * @public
 */
export interface Transaction extends SingleQuery, AsyncDisposable {
  readonly mode: TransactionMode;
  /** 回滚，并释放连接 */
  rollback(): Promise<void>;
  /** 回滚到保存点 */
  rollbackTo(savePoint: string): Promise<void>;
  savePoint(savePoint: string): Promise<void>;
  /** 提交，并释放连接 */
  commit(): Promise<void>;
  get released(): boolean;
}
/**
 * @public
 */
export type TransactionMode =
  | "SERIALIZABLE"
  | "REPEATABLE READ"
  | "READ COMMITTED"
  | "READ UNCOMMITTED";
