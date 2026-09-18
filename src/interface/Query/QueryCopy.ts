import type { SqlStatement } from "./QueryStatement.ts";
import type { QueryCommonOptions } from "./_internal.ts";

/** @public */
export type CopyFromOptions = QueryCommonOptions;

/** @public */
export type CopyToOptions = QueryCommonOptions;

/** @public */
export type CopyQueryOperation = {
  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle;
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array>;
};

/** @public */
export interface CopyFromHandle {
  write(chunk: Uint8Array): Promise<void>;
  closeWrite(): Promise<{ rows: number }>;
  abort(reason?: unknown): Promise<void>;
  readonly writable: WritableStream<Uint8Array>;
  get complete(): Promise<{ rows: number }>;
}
