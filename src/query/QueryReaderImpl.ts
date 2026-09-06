import type { FieldInfo, QueryCompletion } from "./MessageData.ts";
import type { QueryReader, SampleQueryReader } from "./QueryReader.ts";

export interface QueryResult<T> {
  rows: T[];
  fields: readonly Readonly<FieldInfo>[];
  completion: QueryCompletion;
}

export class QueryReaderImpl<T> implements QueryReader<T> {
  constructor(private result: Promise<QueryResult<T>>) {}
  #consumed = false;

  async getRowCount(): Promise<number> {
    return (await this.result).completion.rowCount ?? 0;
  }
  async getCompletion(): Promise<Readonly<QueryCompletion>> {
    return (await this.result).completion;
  }
  async getFields(): Promise<readonly Readonly<FieldInfo>[]> {
    return (await this.result).fields;
  }
  async getRows(limit?: number): Promise<T[]> {
    this.#consume();
    const rows = (await this.result).rows;
    return limit === undefined ? rows : rows.slice(0, limit);
  }
  async getFirstRow(): Promise<T | null> {
    return (await this.getRows(1))[0] ?? null;
  }
  async getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>> {
    return new Map((await this.getRows()).map((row) => [row[key], row]));
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    this.#consume();
    const result = await this.result;
    yield* result.rows;
    return result.completion;
  }
  #consume(): void {
    if (this.#consumed) throw new Error("Query rows have already been consumed");
    this.#consumed = true;
  }
}

/** @public */
export class SampleQueryReaderImpl<T> implements SampleQueryReader<T> {
  constructor(
    readonly rows: T[],
    readonly fields: readonly Readonly<FieldInfo>[],
    readonly notices: string[],
    readonly rowCount: number | null,
  ) {}
  [Symbol.iterator](): Iterator<T> {
    return this.rows[Symbol.iterator]();
  }
}
