import type { DbCursor, DbCursorOption } from "./DbCursor.ts";
import { DbQuery } from "./DbQuery.ts";
import type { DbPool, DbPoolConnection, DbTransaction, SqlLike, TransactionMode } from "./interfaces.ts";
import type { QueryRowsResult } from "./DbQueryBase.ts";
import type { InferQueryResult, SqlStatementDataset } from "./external.ts";

/** @public */
export interface ExecutableSQL<T = unknown> {
  genSql(): string;
  then(resolve: (data: T) => void, reject: () => void): void;
}

/** @public */
export interface QueryableDataSQL<Raw, Res = QueryRowsResult<Raw>> extends ExecutableSQL<Res> {
  query(): Promise<QueryRowsResult<Raw>>;
  queryCount(): Promise<number>;

  queryRows(): Promise<Raw[]>;
  queryFirstRow(): Promise<Raw>;
  queryMap<K>(key: string): Promise<Map<K, Raw>>;
  cursor(): Promise<DbCursor<Raw>>;
}

/**
 * @public
 * 池链接查询
 */
export abstract class DbQueryPool extends DbQuery implements DbPool {
  abstract connect(): Promise<DbPoolConnection>;
  /** 连接池空闲链接数量 */
  abstract idleCount: number;
  /** 连接池总链接数量 */
  abstract totalCount: number;
  abstract begin(mode?: TransactionMode): DbTransaction;
  abstract cursor<T extends {}>(sql: SqlStatementDataset<T>): Promise<DbCursor<T>>;
  abstract cursor<T>(sql: SqlLike, option?: DbCursorOption): Promise<DbCursor<T>>;

  createQueryableSQL<Raw>(statement: SqlStatementDataset<Raw>): QueryableDataSQL<Raw, void>;
  createQueryableSQL<Raw>(statement: SqlLike): QueryableDataSQL<Raw, void>;

  createQueryableSQL<T extends SqlStatementDataset<any>, Res>(
    statement: T,
    transform: (queryable: DbQueryPool, statement: T) => Promise<Res>,
  ): QueryableDataSQL<InferQueryResult<T>, Awaited<Res>>;
  createQueryableSQL<Raw, Res>(
    statement: SqlLike,
    transform: (queryable: DbQueryPool, statement: SqlLike) => Promise<Res>,
  ): QueryableDataSQL<Raw, Res>;
  createQueryableSQL<Raw>(
    statement: SqlLike,
    transform?: (queryable: DbQueryPool, statement: SqlLike) => Promise<any>,
  ): QueryableDataSQL<Raw, any> {
    return new QueryableSqlImpl<Raw>(this, statement, transform);
  }
  createExecutableSQL(statement: SqlLike): ExecutableSQL<void>;
  createExecutableSQL(statement: SqlLike): ExecutableSQL<void> {
    return new QueryableSqlImpl<void, void>(this, statement);
  }
}

class QueryableSqlImpl<Data, Res = QueryRowsResult<Data>> implements QueryableDataSQL<Data, Res> {
  constructor(
    queryClient: DbQueryPool,
    statement: SqlLike,
    transform?: (queryClient: DbQueryPool, statement: SqlLike) => Promise<Res>,
  );
  constructor(
    private queryClient: DbQueryPool,
    private statement: SqlLike,
    private transform: (queryClient: DbQueryPool, statement: SqlLike) => Promise<any> = defaultTransform,
  ) {}
  genSql(): string {
    return this.statement.toString();
  }
  toString() {
    return this.genSql();
  }
  query(): Promise<QueryRowsResult<Data>> {
    return this.queryClient.query<Data>(this.statement);
  }
  queryCount(): Promise<number> {
    return this.queryClient.queryCount(this.statement);
  }
  queryRows(): Promise<Data[]> {
    return this.queryClient.queryRows(this.statement);
  }
  queryFirstRow(): Promise<Data> {
    return this.queryClient.queryFirstRow(this.statement);
  }
  queryMap<K>(key: string): Promise<Map<K, Data>> {
    return this.queryClient.queryMap<any>(this.statement, key);
  }
  cursor(): Promise<DbCursor<Data>> {
    return this.queryClient.cursor<any>(this.statement);
  }
  then(resolve: (data: Res) => void, reject: (error?: any) => void): void {
    this.transform(this.queryClient, this.statement).then(resolve, reject);
  }
}

function defaultTransform(queryClient: DbQueryPool, statement: SqlLike): Promise<void> {
  return queryClient.execute(statement);
}
