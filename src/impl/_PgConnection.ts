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
import type { PgConnection as NativePgConnection } from "../connect.ts";
import type { SampleQueryReader } from "../query.ts";

export class PgConnection extends DbQuery implements DbConnection, DbQueryBase {
  constructor(connection: NativePgConnection) {
    super();
    this.#connection = connection;
  }
  close(): Promise<void> {
    return this.#connection[Symbol.asyncDispose]();
  }

  #connection: NativePgConnection;

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
    for await (const _result of this.#connection.simpleQuery(genSql(input))) {
      // Drain the complete simple-query cycle before returning the connection.
    }
  }
  override async multipleQuery<T extends MultipleQueryResult>(sql: SqlLike | SqlLike[]): Promise<T> {
    const text = sql instanceof Array ? sql.map(sqlLikeToString).join(";\n") : sqlLikeToString(sql);
    return await this.#multiple(text) as T;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  async #multiple(sql: string): Promise<MultipleQueryResult> {
    const results: MultipleQueryResult = [];
    for await (const result of this.#connection.simpleQuery(sql)) results.push(toLegacyResult(result));
    return results;
  }
}

function toLegacyResult(result: SampleQueryReader): QueryRowsResult {
  return { rows: result.rows, rowCount: result.rowCount ?? 0 };
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
