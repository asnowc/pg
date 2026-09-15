import type { FieldInfo, QueryCompletion } from "./MessageData.ts";
import type { SampleQueryReader } from "./QueryReader.ts";

export interface QueryResult<T> {
  rows: T[];
  fields: readonly Readonly<FieldInfo>[];
  completion: QueryCompletion;
}

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
