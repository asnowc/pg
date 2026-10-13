import {
  DbConnection,
  DbQuery,
  DbQueryBase,
  MultipleQueryInput,
  MultipleQueryResult,
  QueryDataInput,
  QueryInput,
  QueryRowsResult,
  SqlLike,
  sqlLikeToString,
} from "#abstract";
import type { PgConnection as Connection } from "@/interface/Connection.ts";

export class PgConnection extends DbQuery implements DbConnection, DbQueryBase {
  constructor(connection: Connection) {
    super();
    this.#connection = connection;
  }
  close(): Promise<void> {
    return this.#connection.close();
  }

  #connection: Connection;

  override query<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: MultipleQueryInput,
  ): Promise<T>;
  override query<T = any>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  override query<T = any>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  override query<T = any>(sql: SqlLike[] | SqlLike): Promise<unknown[] | unknown>;
  override async query<T = any>(input: QueryInput | MultipleQueryInput): Promise<T> {
    const text = genSql(input);
    if (input instanceof Array) {
      return await this.#multiple(text) as T;
    }
    const results = await this.#multiple(text);
    return (results[0] ?? { rows: [], rowCount: 0 }) as T;
  }
  override async execute(input: QueryInput | MultipleQueryInput): Promise<void> {
    return this.#connection.queryMultiple(genSql(input)).then(() => {});
  }
  override async multipleQuery<T extends MultipleQueryResult>(sql: SqlLike | SqlLike[]): Promise<T> {
    const text = sql instanceof Array ? sql.map(sqlLikeToString).join(";\n") : sqlLikeToString(sql);
    return await this.#multiple(text) as T;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  async #multiple(sql: string): Promise<MultipleQueryResult> {
    const allResults = await this.#connection.queryMultiple(sql).allResults();
    return allResults.map((res) => ({
      rowCount: res.rowCount ?? 0,
      rows: res.rows,
    }));
  }
}

function genSql(input: QueryInput | MultipleQueryInput): string {
  if (typeof input === "function") {
    input = input();
  }
  if (input instanceof Array) {
    return input.map(sqlLikeToString).join(";\n");
  } else {
    return sqlLikeToString(input);
  }
}
