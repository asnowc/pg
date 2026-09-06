import type { SqlLike } from "./interfaces.ts";
import type { MultipleQueryResult, QueryRowsResult } from "./DbQueryBase.ts";
import type { SqlStatementDataset } from "./external.ts";

/**
 * @public
 * @deprecated 请改用 `SqlStatement`。
 */
export type QueryInput = SqlLike | (() => SqlLike);
/**
 * @public
 * @deprecated 请改用 `SqlStatement`。
 */
export type QueryDataInput<T> = SqlStatementDataset<T> | (() => SqlStatementDataset<T>);
/**
 * @public
 * @deprecated 请改用 `PgConnection.simpleQuery()`。
 */
export type MultipleQueryInput = SqlLike[] | (() => SqlLike[]);

/**
 * SQL 查询相关操作
 * @public
 * @deprecated 请改用 `PgConnection`。
 */
export abstract class DbQuery {
  abstract execute(sql: QueryInput | MultipleQueryInput): Promise<void>;
  abstract query<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: MultipleQueryInput,
  ): Promise<T>;
  abstract query<T = any>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  abstract query<T = any>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  /**
   * 执行多语句的方法
   * @deprecated 不建议使用。改用 query()
   */
  abstract multipleQuery<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: SqlLike | SqlLike[],
  ): Promise<T>;

  /** 单语句查询受影响的行 */
  queryCount(sql: QueryInput): Promise<number> {
    return this.query(sql).then((res) => {
      if (res.rowCount === null) return 0;
      return res.rowCount;
    });
  }
  /** 单语句查询，不应查询多语句，否则返回错误值  */
  queryRows<T = any>(sql: QueryDataInput<T>): Promise<T[]>;

  /** 单语句查询，不应查询多语句，否则返回错误值  */
  queryRows<T = any>(sql: QueryInput): Promise<T[]>;
  queryRows<T = any>(sql: QueryDataInput<T> | QueryInput): Promise<T[]> {
    return this.query<T>(sql).then((res) => res.rows);
  }
  /** 单语句查询，只返回第一行。如果查询没有返回行，则抛出异常。 */
  queryFirstRow<T = any>(sql: QueryDataInput<T>): Promise<T>;
  queryFirstRow<T = any>(sql: QueryInput): Promise<T>;
  queryFirstRow<T = any>(sql: QueryDataInput<T> | QueryInput): Promise<T> {
    return this.query<T>(sql).then(({ rows, rowCount }) => {
      if (rows.length === 0) throw new Error("Query did not return any rows");
      return rows[0];
    });
  }
  /**
   * 查询行
   * 不应查询单语句，否则返回错误值
   *  @deprecated 不建议使用。
   */
  multipleQueryRows<T extends any[] = any[]>(sql: SqlLike | SqlLike[]): Promise<T[]> {
    return this.multipleQuery(sql).then((res) => res.map((item) => item.rows ?? [])) as Promise<
      T[]
    >;
  }
  /**
   * 指定某一列为key，返回 key 到 row 的映射
   * 单语句查询，不应查询多语句，否则返回错误值
   */
  queryMap<T extends Record<string, any> = Record<string, any>, K extends keyof T = string>(
    sql: QueryDataInput<T>,
    key: K,
  ): Promise<Map<T[K], T>>;
  /**
   * 指定某一列为key，返回 key 到 row 的映射
   * 单语句查询，不应查询多语句，否则返回错误值
   */
  queryMap<T extends Record<string, any> = Record<string, any>, K extends keyof T = string>(
    sql: QueryInput,
    key: K,
  ): Promise<Map<T[K], T>>;
  async queryMap(sql: QueryInput, key: string): Promise<Map<any, any>> {
    const { rows } = await this.query(sql);
    let map = new Map();
    for (let i = 0; i < rows.length; i++) {
      map.set(rows[i][key], rows[i]);
    }
    return map;
  }
}
