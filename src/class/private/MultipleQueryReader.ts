import { MultipleQueryReader as IMultipleQueryReader, QueryOptions, SqlStatements } from "@/interface/Query.ts";
import { processMaybePromise } from "@/_utils/AsyncAble.ts";
import { MultipleStatementPortal, PgSession } from "@/protocol.ts";
import { QueryResult } from "../../interface/Query/QueryReader.ts";
import { GetPgSession } from "@/class/private/QueryFunction.ts";
import { HandleUnavailableError } from "@/_utils/error.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";

export default class MultipleQueryReader<T extends any[] = unknown[]> implements IMultipleQueryReader<T> {
  constructor(getSession: GetPgSession, queryable: SqlStatements, options?: QueryOptions & QueryOptionsWithDecoder) {
    this.#getSession = getSession;
    this.#portal = new MultipleStatementPortal(
      queryable,
      options ? { getResultDecoder: options.getResultDecoder, onNotice: options.onNotice } : undefined,
    );
  }
  #portal: MultipleStatementPortal;
  #getSession?: GetPgSession;
  private getSession<T>(exec: (session: PgSession) => T) {
    if (!this.#getSession) {
      throw new HandleUnavailableError("MultipleQueryReader session is not available");
    }
    const session = this.#getSession();
    this.#getSession = undefined;
    return processMaybePromise(session, exec);
  }
  async all(): Promise<T[]> {
    const results = await this.allResults();
    return results.map((result) => result.rows) as T;
  }

  allResults(): Promise<QueryResult<T[number]>[]> {
    return this.getSession(({ queryWriter }) => {
      return new Promise<QueryResult<T[number]>[]>((resolve, reject) => {
        const items: QueryResult<unknown>[] = [];
        this.#portal.resolve = (result) => items.push(result);
        this.#portal.reject = reject;
        queryWriter.query(this.#portal);
        queryWriter.sync(() => resolve(items as QueryResult<T[number]>[]), reject);
        queryWriter.flush();
      });
    });
  }
  async last<R>(): Promise<R> {
    const results = await this.allResults();
    return results[results.length - 1].rows as R;
  }
  lastResults<T>(): Promise<QueryResult<T>> {
    return this.getSession(({ queryWriter }) => {
      return new Promise<QueryResult<T>>((resolve, reject) => {
        let last: QueryResult<any> | undefined;
        //TODO: 避免解码不需要的语句结果
        this.#portal.resolve = (result) => (last = result);
        this.#portal.reject = reject;

        queryWriter.query(this.#portal);
        queryWriter.sync(() => {
          if (!last) throw new Error("No results returned");
          return resolve(last);
        }, reject);
        queryWriter.flush();
      });
    });
  }
  then<T>(onfulfilled?: (data: undefined) => T, onrejected?: (reason: unknown) => void): Promise<T>;
  then(onfulfilled?: (data: undefined) => unknown, onrejected?: (reason: unknown) => void): Promise<unknown> {
    return this.getSession(({ queryWriter }) => {
      return new Promise<undefined>((resolve, reject) => {
        queryWriter.query(this.#portal);
        queryWriter.flush();
        queryWriter.sync(resolve, reject);
      }).then(onfulfilled, onrejected);
    });
  }
}
