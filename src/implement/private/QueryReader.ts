import type {
  QueryCompletion,
  QueryReader as IQueryReader,
  QueryResult,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { PgSession } from "@/protocol.ts";
import { QueryResultParser } from "@/protocol/parsers/QueryResultParser.ts";

export interface SessionHandle<T extends PgSession = PgSession> {
  get: () => Promise<T>;
  release: (session: T) => void;
}
export default class QueryReader<T = unknown> implements IQueryReader<T> {
  constructor(
    pool: SessionHandle<PgSession>,
    statement: TypedSqlStatementEncoder,
    sync = true,
  ) {
    this.#source = { pool, statement, sync };
  }
  #source?: {
    pool: SessionHandle;
    statement: TypedSqlStatementEncoder;
    sync: boolean;
  };
  #getSession() {
    const source = this.#source;
    if (!source) throw new Error("QueryReader has already been consumed");
    this.#source = undefined;
    return source;
  }

  async getRowCount(): Promise<number> {
    return (await this.#consume()).rowCount ?? 0;
  }
  async getResults(): Promise<QueryResult<T>> {
    const result = await this.#consume<T>();
    return { rows: result.rows, fields: result.fields ?? [], notices: result.notices, rowCount: result.rowCount ?? 0 };
  }
  async getRows(): Promise<T[]> {
    const result = await this.#consume<T>();
    return result.rows;
  }
  async getFirstRow(): Promise<T | null> {
    return (await this.#consume<T>()).rows[0] ?? null;
  }

  async getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>> {
    const map = new Map<T[K], T>();
    for await (const item of this) {
      map.set(item[key], item);
    }
    return map;
  }
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void> {
    return this.#consume<T>().then(() => onfulfilled?.(), onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    const result = await this.#consume<T>();
    yield* result.rows;
    return { rowCount: result.rowCount, notices: result.notices };
  }

  async #consume<T>(): Promise<QueryResultParser<T>> {
    const { pool, statement } = this.#getSession();
    const session = await pool.get();
    let result: Promise<QueryResultParser<T>>;
    try {
      result = session.extendedQuery<T>(statement);
    } finally {
      pool.release(session);
    }
    return await result;
  }
}
