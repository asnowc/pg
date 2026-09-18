import { DbCursor, ParallelQueryError } from "#abstract";
import type { DbPoolConnection } from "#abstract";
import type { Cursor } from "@/interface/Query.ts";

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
  async close(): Promise<void> {
    const conn = this.#conn;
    if (!conn) return;
    this.#conn = undefined;
    try {
      await this.#cursor.close();
      conn.release();
    } catch (error) {
      conn.dispose();
      throw error;
    }
  }
}
