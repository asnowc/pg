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
} from "@asla/yoursql/client";
import { addPgErrorInfo } from "../driver/util.ts";
import type { Client } from "../driver/mod.js";

export class PgConnection extends DbQuery implements DbConnection, DbQueryBase {
  constructor(pool: Client) {
    super();
    this.#pool = pool;
  }
  close(): Promise<void> {
    return this.#pool.end();
  }

  #pool: Client;

  override query<T extends MultipleQueryResult = MultipleQueryResult>(
    sql: MultipleQueryInput,
  ): Promise<T>;
  override query<T = any>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  override query<T = any>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  override query<T = any>(sql: SqlLike[] | SqlLike): Promise<unknown[] | unknown>;
  override query<T = any>(input: QueryInput | MultipleQueryInput): Promise<T> {
    const text = genSql(input);
    return this.#pool.query(text).catch((e) => addPgErrorInfo(e, text)) as any;
  }
  override execute(input: QueryInput | MultipleQueryInput): Promise<void> {
    const text = genSql(input);
    return this.#pool.query(text).then(() => {}, (e) => addPgErrorInfo(e, text)) as any;
  }
  override multipleQuery<T extends MultipleQueryResult>(sql: SqlLike | SqlLike[]): Promise<T> {
    if (sql instanceof Array) sql = sql.map(sqlLikeToString).join(";\n");
    else sql = sqlLikeToString(sql);
    return this.#pool.query(sql) as unknown as Promise<T>;
  }
  //implement
  [Symbol.asyncDispose]() {
    return this.close();
  }
}

function genSql(input: QueryInput | MultipleQueryInput) {
  if (typeof input === "function") {
    input = input();
  }
  if (input instanceof Array) {
    return input.map(sqlLikeToString).join(";\n");
  } else {
    return sqlLikeToString(input);
  }
}
