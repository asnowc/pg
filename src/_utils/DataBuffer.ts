export interface BufferReader {
  /** 可读取的字节长度 */
  get byteLength(): number;
  readInt8(): number;
  readUInt8BE(): number;
  readInt16BE(): number;
  readUInt16BE(): number;
  readInt32BE(): number;
  readUInt32BE(): number;
  readInt64BE(): bigint;
  readUInt64BE(): bigint;
  readBinary(size: number): Uint8Array;
  copyBinary(size: number): Uint8Array;
}
export interface BufferWriter {
  write(data: Uint8Array): void;
  closeWrite(): Promise<void>;
}

export class FixedBufferReader implements BufferReader {
  constructor(buffer: ArrayBuffer, byteOffset?: number, byteLength?: number) {
    this.buffer = new Uint8Array(buffer, byteOffset, byteLength);
    this.view = new DataView(buffer, byteOffset, byteLength);
  }
  readonly view: DataView;
  readonly buffer: Uint8Array;
  #offset: number = 0;
  offsetEnd: number = 0;

  get byteLength() {
    return this.offsetEnd - this.#offset;
  }

  readInt8(): number {
    const value = this.view.getInt8(this.#offset);
    this.#offset += 1;
    return value;
  }
  readUInt8BE(): number {
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
  resetOffset() {
    if (this.#offset === 0) {
      this.offsetEnd = 0;
      this.#offset = 0;
      return;
    }
    this.offsetEnd = this.buffer.copyWithin(0, this.#offset, this.offsetEnd).byteLength;
    this.#offset = 0;
  }
}
