import { DbCursor, DbPoolConnection, ParallelQueryError } from "@asla/yoursql/client";
import { Cursor } from "../driver/mod.js";

export class PgCursor<T> extends DbCursor<T> {
  constructor(cursor: Cursor<T>, conn: DbPoolConnection, readonly defaultChunkSize = 20) {
    super();
    this.#cursor = cursor;
    this.#conn = conn;
  }
  #conn?: DbPoolConnection;
  #cursor: Cursor<T>;
  #pending?: Promise<unknown>;
  // implement
  read(maxSize: number = this.defaultChunkSize): Promise<T[]> {
    if (this.#pending) return Promise.reject(new ParallelQueryError());
    const promise = this.#cursor.read(maxSize).finally(() => (this.#pending = undefined));
    this.#pending = promise;
    return promise;
  }
  // implement
  close(): Promise<void> {
    this.#conn?.release();
    this.#conn = undefined;
    return this.#cursor.close();
  }
}
