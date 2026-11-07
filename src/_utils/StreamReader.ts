/**
 * 字节流读取器。执行读取操作前需要确保有足够的可读字节。
 */
export interface StreamReader {
  readonly buffer: Uint8Array;
  readonly view: DataView;
  get readableEnd(): number;
  /** 当前读取偏移量，即下一个读取操作将从该偏移量开始 */
  readableStart: number;
  /** 可读取的字节长度 */
  get readableLength(): number;
}

export class BufferReader implements StreamReader {
  constructor(buffer: Uint8Array, dataSize: number = 0) {
    this.buffer = buffer;
    this.readableEnd = dataSize;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  readonly view: DataView;
  readonly buffer: Uint8Array;
  /** 已读取的偏移量，即下一个读取操作将从该偏移量开始 */
  #readOffset: number = 0;
  /** 已写入的偏移量，即下一个写入操作将从该偏移量开始 */
  readableEnd: number;
  get readableStart(): number {
    return this.#readOffset;
  }
  set readableStart(value: number) {
    this.#readOffset = value;
  }

  /** 将数据推入缓冲区，返回实际写入缓冲区的字节数 */
  pushReaderBufferData(chunk: Uint8Array): number {
    const availableLength = this.buffer.byteLength - this.readableEnd;
    const writtenLength = Math.min(chunk.byteLength, availableLength);
    this.buffer.set(chunk.subarray(0, writtenLength), this.readableEnd);
    this.readableEnd += writtenLength;
    return writtenLength;
  }
  getIdleFreeReaderBuffer(): Uint8Array {
    return this.buffer.subarray(this.readableEnd);
  }

  get readableLength(): number {
    return this.readableEnd - this.#readOffset;
  }

  /**
   * 重置偏移量，将未读数据移动到缓冲区开头并更新偏移量。
   */
  gc() {
    if (this.#readOffset === 0) {
      return;
    }
    const unreadLength = this.readableEnd - this.#readOffset;
    this.buffer.copyWithin(0, this.#readOffset, this.readableEnd);
    this.readableEnd = unreadLength;
    this.#readOffset = 0;
  }
}
