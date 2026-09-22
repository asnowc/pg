export abstract class ReaderWriter implements WriterBuffer {
  constructor(bufferSize: number) {
    const buffer = new Uint8Array(bufferSize);
    this.buffer = buffer;
    this.#dataView = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  buffer: Uint8Array;
  readonly #dataView: DataView;
  offset: number = 0;
  offsetEnd: number = 0;

  /** 可读取的字节长度 */
  get byteLength() {
    return this.offsetEnd - this.offset;
  }

  readInt8(): number {
    const value = this.#dataView.getInt8(this.offset);
    this.offset += 1;
    return value;
  }
  readUInt8BE(): number {
    const value = this.#dataView.getUint8(this.offset);
    this.offset += 1;
    return value;
  }
  readInt16BE(): number {
    const value = this.#dataView.getInt16(this.offset);
    this.offset += 2;
    return value;
  }
  readUInt16BE(): number {
    const value = this.#dataView.getUint16(this.offset);
    this.offset += 2;
    return value;
  }
  readInt32BE(): number {
    const value = this.#dataView.getInt32(this.offset);
    this.offset += 4;
    return value;
  }
  readUInt32BE(): number {
    const value = this.#dataView.getUint32(this.offset);
    this.offset += 4;
    return value;
  }
  readInt64BE(): bigint {
    const value = this.#dataView.getBigInt64(this.offset);
    this.offset += 8;
    return value;
  }
  readUInt64BE(): bigint {
    const value = this.#dataView.getBigUint64(this.offset);
    this.offset += 8;
    return value;
  }
  readBinary(size: number): Uint8Array {
    const start = this.offset;
    this.offset = start + size;
    return this.buffer.subarray(start, this.offset);
  }
  /**
   * 重置偏移量，将未读数据移动到缓冲区开头并更新偏移量。
   */
  resetOffset() {
    this.offsetEnd = this.buffer.copyWithin(0, this.offset, this.offsetEnd).byteLength;
    this.offset = 0;
  }
  /** 获取缓冲区中未使用的部分 */
  getUnused(): Uint8Array {
    return this.buffer.subarray(this.offsetEnd);
  }

  /**
   * 增加可读取的字节长度
   */
  grow(size: number) {
    this.offsetEnd += size;
    this.onData();
  }
  onEnd() {}

  onData() {
    throw new Error("No custom onData implementation provided");
  }
  abstract closeWrite(): Promise<void>;
  abstract write(...data: Uint8Array[]): Promise<void>;
  abstract destroy(): void;
}

export interface WriterBuffer {
  write(...data: Uint8Array[]): Promise<void>;
  closeWrite(): Promise<void>;
}
