/**
 * 字节流读取器。执行读取操作前需要确保有足够的可读字节。
 */
export interface StreamReader {
  /** 可读取的字节长度 */
  get readableLength(): number;
  readInt8(): number;
  readUInt8(): number;
  readInt16BE(): number;
  readUInt16BE(): number;
  readInt32BE(): number;
  readUInt32BE(): number;
  readInt64BE(): bigint;
  readUInt64BE(): bigint;
  /**
   * 读取指定长度的字节，并返回一个指向原始缓冲区的 Uint8Array。
   * 注意：返回的 Uint8Array 可能会被覆盖，必须立即消费。
   */
  readBinary(size: number): Uint8Array;
  /** 复制指定长度的字节，不会影响原始缓冲区的数据 */
  copyBinary(size: number): Uint8Array;
}

/**
 * 用于解析字节块的接口，每次调用 next 方法时传入一个 BufferReader，返回解析结果或 undefined。
 */
export interface StreamParser<T> {
  next(reader: StreamReader): undefined | T;
}

export class BufferReader implements StreamReader {
  constructor(buffer: Uint8Array, dataSize: number = 0) {
    this.buffer = buffer;
    this.readerBufferWriteOffset = dataSize;
    this.#dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  #dataView: DataView;
  readonly buffer: Uint8Array;
  /** 已读取的偏移量，即下一个读取操作将从该偏移量开始 */
  #readOffset: number = 0;
  /** 已写入的偏移量，即下一个写入操作将从该偏移量开始 */
  readerBufferWriteOffset: number;

  /** 将数据推入缓冲区，返回实际写入缓冲区的字节数 */
  pushReaderBufferData(chunk: Uint8Array): number {
    const availableLength = this.buffer.byteLength - this.readerBufferWriteOffset;
    const writtenLength = Math.min(chunk.byteLength, availableLength);
    this.buffer.set(chunk.subarray(0, writtenLength), this.readerBufferWriteOffset);
    this.readerBufferWriteOffset += writtenLength;
    return writtenLength;
  }
  getIdleFreeReaderBuffer(): Uint8Array {
    return this.buffer.subarray(this.readerBufferWriteOffset);
  }

  get readableLength(): number {
    return this.readerBufferWriteOffset - this.#readOffset;
  }

  readInt8(): number {
    const value = this.#dataView.getInt8(this.#readOffset);
    this.#readOffset += 1;
    return value;
  }
  readUInt8(): number {
    const value = this.#dataView.getUint8(this.#readOffset);
    this.#readOffset += 1;
    return value;
  }
  readInt16BE(): number {
    const value = this.#dataView.getInt16(this.#readOffset);
    this.#readOffset += 2;
    return value;
  }
  readUInt16BE(): number {
    const value = this.#dataView.getUint16(this.#readOffset);
    this.#readOffset += 2;
    return value;
  }
  readInt32BE(): number {
    const value = this.#dataView.getInt32(this.#readOffset);
    this.#readOffset += 4;
    return value;
  }
  readUInt32BE(): number {
    const value = this.#dataView.getUint32(this.#readOffset);
    this.#readOffset += 4;
    return value;
  }
  readInt64BE(): bigint {
    const value = this.#dataView.getBigInt64(this.#readOffset);
    this.#readOffset += 8;
    return value;
  }
  readUInt64BE(): bigint {
    const value = this.#dataView.getBigUint64(this.#readOffset);
    this.#readOffset += 8;
    return value;
  }
  readBinary(size: number): Uint8Array {
    const start = this.#readOffset;
    this.#readOffset = start + size;
    return this.buffer.subarray(start, this.#readOffset);
  }
  copyBinary(size: number): Uint8Array {
    const start = this.#readOffset;
    this.#readOffset = start + size;
    const buffer = new Uint8Array(size);
    buffer.set(this.buffer.subarray(start, this.#readOffset));
    return buffer;
  }

  /**
   * 重置偏移量，将未读数据移动到缓冲区开头并更新偏移量。
   */
  gc() {
    if (this.#readOffset === 0) {
      return;
    }
    const unreadLength = this.readerBufferWriteOffset - this.#readOffset;
    this.buffer.copyWithin(0, this.#readOffset, this.readerBufferWriteOffset);
    this.readerBufferWriteOffset = unreadLength;
    this.#readOffset = 0;
  }
}
