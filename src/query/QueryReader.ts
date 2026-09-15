import type { PgMessageReader } from "@/protocol.ts";
import type { FieldInfo, QueryCompletion } from "./MessageData.ts";
import type { StatementEncoder } from "./QueryStatement.ts";
import {
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
} from "@/protocol/pg_message.ts";

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
  constructor(reader: PgMessageReader, statement: StatementEncoder) {
    this.#reader = { reader, statement };
  }
  #reader?: { reader: PgMessageReader; statement: StatementEncoder };
  #getReader() {
    const reader = this.#reader;
    if (!reader) throw new Error("QueryReader is not initialized");
    this.#reader = undefined;
    return reader;
  }
  async #send() {
    const { reader, statement } = this.#getReader();
    await reader.write(encodeParseMessage(statement));
    await reader.write(encodeBindMessage(statement));
    await reader.write(encodeExecuteMessage(0));
  }

  /** 受影响的行数 */
  async getRowCount(): Promise<number> {
  }
  getCompletion(): Promise<Readonly<QueryCompletion>>;
  getFields(): Promise<readonly Readonly<FieldInfo>[]>;
  /**
   * 获取所有列
   * @param limit 限制从 PostgreSQL 服务端输出返回的最大行数。
   * @example
   * const rows = await query.getRows(10); // 获取最多 10 行数据
   */
  async getRows(limit?: number): Promise<T[]> {
    const { reader, statement } = this.#getReader();
    await reader.write(encodeParseMessage(statement));
    await reader.write(encodeBindMessage(statement));
    await reader.write(encodeDescribeMessage(0x50));
    await reader.write(encodeExecuteMessage(0));
  }
  /**
   * 只获取第一行数据
   * @returns 第一行数据，如果没有数据则返回 null。
   */
  async getFirstRow(): Promise<T | null> {
    const { reader, statement } = this.#getReader();
    await reader.write(encodeParseMessage(statement));
    await reader.write(encodeBindMessage(statement));
    await reader.write(encodeDescribeMessage(0x50));
    await reader.write(encodeExecuteMessage(1));
    await reader.write(encodeClose);
    let message = await reader.read();
    while (!message || message.type) {
    }
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
  then(onfulfilled?: (value: void) => void, onrejected?: (reason: unknown) => void): Promise<void> {
    return this.#queryIgnoreResult().then(onfulfilled, onrejected);
  }
  async #queryIgnoreResult() {
    const { reader, statement } = this.#getReader();
    await reader.write(encodeParseMessage(statement));
    await reader.write(encodeBindMessage(statement));
    await reader.write(encodeExecuteMessage(0));
  }
  /**
   * 获取异步迭代器，用于遍历查询结果。
   * @example
   * for await (const item of query) {
   *   console.log(item);
   * }
   */
  [Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void>;
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
