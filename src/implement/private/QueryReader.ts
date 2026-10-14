import type {
  QueryCompletion,
  QueryReader as IQueryReader,
  QueryResult,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { PgSession } from "@/protocol.ts";
import { QueryResultParser } from "@/protocol/parsers/QueryResultParser.ts";

export interface SessionHandle<T extends PgSession = PgSession> {
  get: () => Promise<T> | T;
  release: (session: T) => void;
}
export default class QueryReader<T = unknown> implements IQueryReader<T> {
  constructor(source: { pool: SessionHandle; statement: TypedSqlStatementEncoder; isolated: boolean }) {
    this.#source = source;
  }
  #source?: {
    pool: SessionHandle;
    statement: TypedSqlStatementEncoder;
    isolated: boolean;
  };
  #getSession() {
    const source = this.#source;
    if (!source) throw new Error("QueryReader has already been consumed");
    this.#source = undefined;
    return source;
  }

  async rowCount(): Promise<number> {
    return (await this.#consume()).rowCount ?? 0;
  }
  async results(): Promise<QueryResult<T>> {
    const result = await this.#consume<T>();
    return { rows: result.rows, fields: result.fields ?? [], notices: result.notices, rowCount: result.rowCount ?? 0 };
  }
  async rows(): Promise<T[]> {
    const result = await this.#consume<T>();
    return result.rows;
  }
  async firstRow(): Promise<T | null> {
    const result = await this.#consume<T>();
    return result.rows[0] ?? null;
  }

  async map<K extends keyof T>(key: K): Promise<Map<T[K], T>> {
    const map = new Map<T[K], T>();
    for await (const item of this) {
      map.set(item[key], item);
    }
    return map;
  }
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void> {
    return this.#consume<T>().then(onfulfilled, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    const result = await this.#consume<T>();
    yield* result.rows;
    return { rowCount: result.rowCount, notices: result.notices };
  }

  async #consume<T>(): Promise<QueryResultParser<T>> {
    const { pool, statement, isolated: sync } = this.#getSession();
    return getMaybePromise(pool.get(), (session) => {
      const promise = session.extendedQuery<T>(statement);
      if (sync) session.sync();
      session.checkWriteQueue();
      pool.release(session);
      return promise;
    });
  }
}
function getMaybePromise<T, R>(maybePromise: Promise<T> | T, onOk: (value: T) => R): R | Promise<R> {
  if ((maybePromise instanceof Promise)) {
    return maybePromise.then(onOk);
  }
  return onOk(maybePromise);
}
