/** @public */
export interface DbCursorOption {
  defaultSize?: number;
}

/** @public */
export abstract class DbCursor<T> implements AsyncDisposable, AsyncIterable<T> {
  /** 读取游标，如果读取结束，返回空数组 */
  abstract read(maxSize?: number): Promise<T[]>;
  /** 提前关闭游标，如果多次调用，会被忽略 */
  abstract close(): Promise<void>;
  // implement
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<T, undefined, void> {
    let data = await this.read();
    try {
      while (data.length) {
        yield* data;
        data = await this.read();
      }
    } finally {
      await this.close();
    }
  }
}
