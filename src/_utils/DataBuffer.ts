/**
 * 二进制缓冲区读取器。
 */
export interface BufferReader {
  /** 可读取的字节长度 */
  get readerLength(): number;
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
 * 二进制缓冲区队列写入器。
 */
export interface BufferWriter {
  startWrite(onWriteInto: (buffer: Uint8Array, offset: number) => number | Promise<number>): void;
  write(data: Uint8Array): void;
  writeWith(data: () => Promise<Uint8Array> | Uint8Array): void;
  closeWrite(): Promise<void>;
}

export interface ByteBuffer extends BufferReader, BufferWriter {
  startRead(onData: () => boolean): void;
  onEnd: () => void;
  destroy(): void;
}

export class FixedBufferReader implements BufferReader {
  constructor(buffer: Uint8Array) {
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  readonly view: DataView;
  readonly buffer: Uint8Array;
  #offset: number = 0;
  offsetEnd: number = 0;

  get readerLength(): number {
    return this.offsetEnd - this.#offset;
  }

  readInt8(): number {
    const value = this.view.getInt8(this.#offset);
    this.#offset += 1;
    return value;
  }
  readUInt8(): number {
    const value = this.view.getUint8(this.#offset);
    this.#offset += 1;
    return value;
  }
  readInt16BE(): number {
    const value = this.view.getInt16(this.#offset);
    this.#offset += 2;
    return value;
  }
  readUInt16BE(): number {
    const value = this.view.getUint16(this.#offset);
    this.#offset += 2;
    return value;
  }
  readInt32BE(): number {
    const value = this.view.getInt32(this.#offset);
    this.#offset += 4;
    return value;
  }
  readUInt32BE(): number {
    const value = this.view.getUint32(this.#offset);
    this.#offset += 4;
    return value;
  }
  readInt64BE(): bigint {
    const value = this.view.getBigInt64(this.#offset);
    this.#offset += 8;
    return value;
  }
  readUInt64BE(): bigint {
    const value = this.view.getBigUint64(this.#offset);
    this.#offset += 8;
    return value;
  }
  readBinary(size: number): Uint8Array {
    const start = this.#offset;
    this.#offset = start + size;
    return this.buffer.subarray(start, this.#offset);
  }
  copyBinary(size: number): Uint8Array {
    const start = this.#offset;
    this.#offset = start + size;
    const buffer = new Uint8Array(size);
    buffer.set(this.buffer.subarray(start, this.#offset));
    return buffer;
  }
  getUnused(): Uint8Array {
    return this.buffer.subarray(this.#offset, this.offsetEnd);
  }

  /**
   * 重置偏移量，将未读数据移动到缓冲区开头并更新偏移量。
   */
  gc() {
    if (this.#offset === 0) {
      this.offsetEnd = 0;
      this.#offset = 0;
      return;
    }
    this.offsetEnd = this.buffer.copyWithin(0, this.#offset, this.offsetEnd).byteLength;
    this.#offset = 0;
  }
}

export interface ByteChunkParser<T> {
  next(reader: BufferReader): undefined | T;
}
