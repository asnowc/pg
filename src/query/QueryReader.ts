import type { PgMessageReader } from "@/protocol.ts";
import type { FieldInfo, QueryCompletion } from "./MessageData.ts";
import type { StatementEncoder } from "./QueryStatement.ts";
import {
  DescribeTarget,
  encodeBindMessage,
  encodeCloseMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
} from "@/protocol/pg_message.ts";
import { FRAME } from "@/protocol/pg_message/_static_frame.ts";

/**
 * `QueryReader.getRows()`、`QueryReader.getFirstRow()`、`QueryReader.getMap()`、方法在一次查询后只能调用一次，重复调用将抛出异常
 *
 * @example
 *  //异步迭代器用法, 用于遍历查询结果。该方法通过 batch() 方法实现。
 *  for await (const item of query) {
 *    console.log(item);
 *  }
 * @public
 */
export class QueryReader<T = unknown> implements AsyncIterable<T> {
  constructor(reader: () => Promise<PgMessageReader>, statement: StatementEncoder) {
    this.#source = { getReader: reader, statement };
  }
  #source?: { getReader: () => Promise<PgMessageReader>; statement: StatementEncoder };
  async #getReader() {
    const source = this.#source;
    if (!source) throw new Error("QueryReader is not initialized");
    this.#source = undefined;
    const reader = await source.getReader();
    return { reader, statement: source.statement };
  }
  async #send() {
    const { reader, statement } = await this.#getReader();
    await reader.write(encodeParseMessage(statement));
    await reader.write(encodeBindMessage(statement));
    return reader;
  }
  async #queryIgnoreResult() {
    const reader = await this.#send();
    await reader.write(encodeExecuteMessage(1));
    await reader.write(encodeCloseMessage(DescribeTarget.Portal));
    await reader.write(FRAME.SYNC);
    return reader;
  }
  async #queryAllResult() {
    const reader = await this.#send();
    await reader.write(encodeDescribeMessage(DescribeTarget.Portal));
    await reader.write(encodeExecuteMessage(0));
    await reader.write(FRAME.SYNC);
    return reader;
  }

  /** 受影响的行数 */
  async getRowCount(): Promise<number> {
    const { rowCount } = await this.getCompletion();
    return rowCount ?? 0;
  }
  async getCompletion(): Promise<Readonly<QueryCompletion>> {
    const reader = await this.#queryAllResult();
  }
  getFields(): Promise<readonly Readonly<FieldInfo>[]>;
  /**
   * 获取所有列
   * @param limit 限制从 PostgreSQL 服务端输出返回的最大行数。
   * @example
   * const rows = await query.getRows(10); // 获取最多 10 行数据
   */
  async getRows(limit?: number): Promise<T[]> {
    const reader = await this.#queryAllResult();
  }
  /**
   * 只获取第一行数据
   * @returns 第一行数据，如果没有数据则返回 null。
   */
  async getFirstRow(): Promise<T | null> {
    const reader = await this.#queryIgnoreResult();
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
    const reader = await this.#queryAllResult();
  }
}

/** @public */
export enum CursorStatus {
  Open = "opening",
  Closed = "closed",
  Completed = "completed",
}

/** @public */
export interface PgCursor<T> extends AsyncDisposable, AsyncIterable<T> {
  /** 已从服务端读取的行数，包含迭代器预取批次中尚未产出的行。 */
  get rowsRead(): number;

  /** 查询是否已关闭 */
  get isClosed(): boolean;
  /**
   * 提前关闭游标。重复关闭将被忽略。
   */
  close(): Promise<void>;
  /** 不允许并发读取；迭代器取得读取权后返回空数组。 */
  read(maxRows?: number): Promise<T[]>;

  get fields(): Promise<readonly Readonly<FieldInfo>[]>;
  get completion(): Promise<QueryCompletion>;
}

/** @public */
export interface SampleQueryReader<T = unknown> {
  rowCount: number | null;
  get fields(): readonly Readonly<FieldInfo>[];
  get notices(): string[];
  get rows(): T[];
  [Symbol.iterator](): Iterator<T>;
}
