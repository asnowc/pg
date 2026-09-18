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
    if (!source) throw new Error("QueryReader is not initialized");
    this.#source = undefined;
    const session = typeof source.getSession === "function" ? await source.getSession() : source.getSession;
    return { session, statement: source.statement };
  }
  async #send() {
    const { session, statement } = await this.#getSession();
    await session.write(encodeParseMessage(statement));
    await session.write(encodeBindMessage(statement));
    return session;
  }
  async #queryIgnoreResult() {
    const session = await this.#send();
    await session.write(encodeExecuteMessage(1));
    await session.write(encodeCloseMessage(DescribeTarget.Portal));
    await session.write(FRAME.SYNC);
    return session;
  }
  async #queryAllResult() {
    const session = await this.#send();
    await session.write(encodeDescribeMessage(DescribeTarget.Portal));
    await session.write(encodeExecuteMessage(0));
    await session.write(FRAME.SYNC);
    return session;
  }

  /** 受影响的行数 */
  async getRowCount(): Promise<number> {
    await this.#queryAllResult();
    throw new Error("Not implemented");
  }
  async results(): Promise<QueryResult<T>> {
    throw new Error("Not implemented");
  }
  /**
   * 获取所有列
   * @param limit 限制从 PostgreSQL 服务端输出返回的最大行数。
   * @example
   * const rows = await query.getRows(10); // 获取最多 10 行数据
   */
  async getRows(limit?: number): Promise<T[]> {
    const session = await this.#queryAllResult();
    throw new Error("Not implemented");
  }
  /**
   * 只获取第一行数据
   * @returns 第一行数据，如果没有数据则返回 null。
   */
  async getFirstRow(): Promise<T | null> {
    const session = await this.#queryIgnoreResult();
    throw new Error("Not implemented");
  }

  /**
   * 根据指定的字段名获取一个 Map，其中 key 为指定字段的值，value 为对应的行数据。
   * @param key 指定的字段名
   * @returns 返回一个 Map，其中 key 为指定字段的值，value 为对应的行数据。
   */
  async getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>> {
    const map = new Map<T[K], T>();
    for await (const item of this) {
      map.set(item[key], item);
    }
    return map;
  }
  // reduce<R>(reducer: (accumulator: R, currentValue: T) => R, initialValue: R): Promise<R>;
  /** 等待查询完成，忽略行数据；不会消耗后续 getRows() 的读取机会。 */
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void> {
    return this.#queryIgnoreResult().then(() => onfulfilled?.(), onrejected);
  }

  /**
   * 获取异步迭代器，用于遍历查询结果。
   * @example
   * for await (const item of query) {
   *   console.log(item);
   * }
   */
  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    const session = await this.#queryAllResult();
    throw new Error("Not implemented");
  }
}
