import type {
  PgCursor,
  QueryReader,
  SampleQueryReader,
  SqlStatementData,
  TypedSqlStatement,
  TypedSqlStatementTemplate,
} from "@/query.ts";
import type { PgSessionInfo } from "@/protocol.ts";

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
/**
 * 已经完成认证的 PostgreSQL 连接接口，提供执行 SQL 查询、打开游标以及复制数据的功能。
 * @public
 */
export interface PgConnection extends AsyncDisposable {
  /** 认证后收集的服务端参数、取消请求密钥和事务状态。 */
  readonly session: PgSessionInfo;
  /** 连接是否已关闭或因不可恢复的协议/网络错误而失效。 */
  readonly closed: boolean;
  /**
   * 从流中读取 SQL 并执行简单查询
   */
  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array>;

  /**
   * @param queryable 只能可以是是多条 SQL 语句，Uint8Array[] 可以表示多条 SQL 语句的分片
   */
  simpleQuery(queryable: SqlStatements, options?: QueryOptions): AsyncIterable<SampleQueryReader>;
  simpleQuery(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): AsyncIterable<SampleQueryReader>;

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

  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle;
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array>;
  [Symbol.asyncDispose](): Promise<void>;
}

/** @public */
export interface CopyFromHandle {
  write(chunk: Uint8Array): Promise<void>;
  closeWrite(): Promise<{ rows: number }>;
  abort(reason?: unknown): Promise<void>;
  readonly writable: WritableStream<Uint8Array>;
  get complete(): Promise<{ rows: number }>;
}

/**
 * 表示可以包含单条 SQL 语句的查询对象
 * @public
 */
export type SqlStatement<T> = TypedSqlStatementTemplate<T> | TypedSqlStatement<T> | SqlStatementData;
/**
 * 表示可以包含多条 SQL 语句的查询对象
 * @public
 */
export type SqlStatements = TypedSqlStatement<unknown> | SqlStatementData;
