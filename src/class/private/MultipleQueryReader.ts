import { MultipleQueryReader as IMultipleQueryReader } from "@/interface/Query.ts";
import { processMaybePromise } from "@/_utils/AsyncAble.ts";
import { PgSession } from "@/protocol.ts";
import { QueryResult } from "../../interface/Query/QueryReader.ts";
import { GetPgSession } from "@/class/private/QueryFunction.ts";
import { HandleUnavailableError } from "@/_utils/error.ts";
import { PreparedMultipleStatement } from "@/class/PreparedMultipleStatement.ts";

export default class MultipleQueryReader implements IMultipleQueryReader {
  constructor(
    getSession: GetPgSession,
    private statement: PreparedMultipleStatement,
  ) {
    this.#getSession = getSession;
  }
  #getSession?: GetPgSession;
  private getSession<T>(exec: (session: PgSession) => T) {
    if (!this.#getSession) {
      throw new HandleUnavailableError("MultipleQueryReader session is not available");
    }
    const session = this.#getSession();
    this.#getSession = undefined;
    return processMaybePromise(session, exec);
  }
  async all(): Promise<unknown[][]> {
    const results = await this.allResults();
    return results.map((result) => result.rows);
  }
  allResults(): Promise<QueryResult<unknown>[]> {
    return this.getSession(async (session) => {
      const items: QueryResult<unknown>[] = [];
      await session.queryWriter.simpleQuery(this.statement, (result) => items.push(result));
      return items;
    });
  }
  async last<R>(): Promise<R> {
    const results = await this.allResults();
    return results[results.length - 1].rows as R;
  }
  lastResults<T>(): Promise<QueryResult<T>> {
    return this.getSession(async (session) => {
      let last: QueryResult<any> | undefined;
      //TODO: 避免解码不需要的语句结果
      await session.queryWriter.simpleQuery(this.statement, (result) => last = result);
      if (!last) throw new Error("No results returned");
      return last!;
    });
  }
  then<T>(onfulfilled?: (data: undefined) => T, onrejected?: (reason: unknown) => void): Promise<T>;
  then(onfulfilled?: (data: undefined) => unknown, onrejected?: (reason: unknown) => void): Promise<unknown> {
    return this.getSession((session) => {
      return session.queryWriter.simpleQuery(this.statement).then(
        () => onfulfilled?.(undefined),
        onrejected,
      );
    });
  }
}
