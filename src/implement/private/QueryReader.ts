import type { QueryCompletion, QueryReader as IQueryReader, QueryResult } from "@/interface/Query.ts";
import { QueryResultParser } from "@/protocol/parsers/QueryResultParser.ts";

export default class QueryReader<T = unknown> implements IQueryReader<T> {
  constructor(sendExtendQuery: () => Promise<QueryResultParser<T>>) {
    this.#sendExtendQuery = sendExtendQuery;
  }
  #sendExtendQuery?: () => Promise<QueryResultParser<T>>;
  #send() {
    const send = this.#sendExtendQuery;
    if (!send) throw new Error("QueryReader has already been consumed");
    this.#sendExtendQuery = undefined;
    return send();
  }

  async rowCount(): Promise<number> {
    return (await this.#send()).rowCount ?? 0;
  }
  async results(): Promise<QueryResult<T>> {
    const result = await this.#send();
    return { rows: result.rows, fields: result.fields ?? [], notices: result.notices, rowCount: result.rowCount ?? 0 };
  }
  async rows(): Promise<T[]> {
    const result = await this.#send();
    return result.rows;
  }
  async firstRow(): Promise<T | null> {
    const result = await this.#send();
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
    return this.#send().then(onfulfilled, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    const result = await this.#send();
    yield* result.rows;
    return { rowCount: result.rowCount, notices: result.notices };
  }
}
