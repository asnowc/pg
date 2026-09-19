import type { PgSession } from "@/protocol.ts";
import type { QueryCompletion, QueryReader as IQueryReader, QueryResult, StatementEncoder } from "@/interface/Query.ts";
import {
  DescribeTarget,
  encodeBindMessage,
  encodeCloseMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
  FRAME,
} from "@/protocol.ts";

export default class QueryReader<T = unknown> implements IQueryReader<T> {
  constructor(session: PgSession | (() => Promise<PgSession>), statement: StatementEncoder) {
    this.#source = { getSession: session, statement };
  }
  #source?: { getSession: PgSession | (() => Promise<PgSession>); statement: StatementEncoder };
  async #getSession() {
    const source = this.#source;
    if (!source) throw new Error("QueryReader has already been consumed");
    this.#source = undefined;
    const session = typeof source.getSession === "function" ? await source.getSession() : source.getSession;
    return { session, statement: source.statement };
  }

  async getRowCount(): Promise<number> {
    const { session, statement } = await this.#getSession();
    await sendExecuteWithResult(session, statement);
    let message = await session.read();
    while (message) {
      switch (message.type) {
        case value:
          break;

        default:
          break;
      }
    }

    throw new Error("Not implemented");
  }
  async getResults(): Promise<QueryResult<T>> {
    const { session, statement } = await this.#getSession();
    await sendExecuteWithResult(session, statement);
    throw new Error("Not implemented");
  }
  async getRows(limit?: number): Promise<T[]> {
    const { session, statement } = await this.#getSession();
    await sendExecuteWithResult(session, statement, true);
    throw new Error("Not implemented");
  }
  async getFirstRow(): Promise<T | null> {
    const { session, statement } = await this.#getSession();
    await sendExecuteIgnoreResult(session, statement, true);
    throw new Error("Not implemented");
  }

  async getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>> {
    const map = new Map<T[K], T>();
    for await (const item of this) {
      map.set(item[key], item);
    }
    return map;
  }
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void> {
    return this.#getSession().then(async ({ session, statement }) => {
      await sendExecuteWithResult(session, statement, true);
    }).then(onfulfilled, onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    const { session, statement } = await this.#getSession();
    await sendExecuteWithResult(session, statement, true);
    throw new Error("Not implemented");
  }
}
async function sendExecuteIgnoreResult(session: PgSession, statement: StatementEncoder, describe?: boolean) {
  await session.write(encodeParseMessage(statement));
  await session.write(encodeBindMessage(statement));
  if (describe) await session.write(encodeDescribeMessage(DescribeTarget.Portal));
  await session.write(encodeExecuteMessage(1));
  await session.write(encodeCloseMessage(DescribeTarget.Portal));
  await session.write(FRAME.SYNC);
}

async function sendExecuteWithResult(session: PgSession, statement: StatementEncoder, describe?: boolean) {
  await session.write(encodeParseMessage(statement));
  await session.write(encodeBindMessage(statement));
  if (describe) await session.write(encodeDescribeMessage(DescribeTarget.Portal));
  await session.write(encodeExecuteMessage(0));
  await session.write(FRAME.SYNC);
}
