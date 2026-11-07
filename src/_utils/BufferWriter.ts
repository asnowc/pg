/**
 * | buffered data | writable space |
 * |0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 |
 *                  ^
 *             writeOffset
 */
export class BufferWriter {
  constructor(
    private callWrite: (buffer: Uint8Array) => Promise<number>,
    bufferOrSize: Uint8Array | number,
    flushThreshold?: number,
  ) {
    const writeBuffer = typeof bufferOrSize === "number" ? new Uint8Array(bufferOrSize) : bufferOrSize;
    this.buffer = writeBuffer;

    this.callWriteThreshold = typeof flushThreshold === "number"
      ? Math.floor(flushThreshold)
      : Math.floor(writeBuffer.byteLength / 2);

    if (this.callWriteThreshold <= 0 || this.callWriteThreshold > writeBuffer.byteLength) {
      throw new Error("flushThreshold must be a positive integer and less than or equal to the buffer length.");
    }
    this.view = new DataView(writeBuffer.buffer, writeBuffer.byteOffset, writeBuffer.byteLength);
  }
  /**
   * 缓冲区数据达到此字节数时触发写入。空缓冲区中的大块数据可以绕过缓冲区直接写入。
   * 假设每次调用 callWrite 最大能消费 n，flushThreshold 应该设置为小于或等于 n 的值。
   * 这个值越小，延迟越低，但调用 callWrite 的频率会增加。
   * 这个值超过 n 会导致缓冲区积累过多数据，从而增加延迟，且不会降低 callWrite 的调用次数。
   */
  private readonly callWriteThreshold: number;
  readonly buffer: Uint8Array;
  readonly view: DataView;
  writeOffset: number = 0;

  /** 可写入到 FixedBufferWriter 的字节长度 */
  get writableLength(): number {
    return this.buffer.byteLength - this.writeOffset;
  }

  /**
   * 将缓冲区中的数据全部写入底层。
   */
  async flush(): Promise<void> {
    let totalWritten = 0;
    while (totalWritten < this.writeOffset) {
      totalWritten += await this.callWrite(this.buffer.subarray(totalWritten, this.writeOffset));
    }
    this.writeOffset = 0;
  }

  /**
   * 从缓冲区写入数据，直到累计写入量严格大于 minimumBytesToWrite。
   */
  async transferBuffer(minimumBytesToWrite: number = 0): Promise<number> {
    let totalWritten = 0;
    do {
      totalWritten += await this.callWrite(this.buffer.subarray(totalWritten, this.writeOffset));
    } while (totalWritten < minimumBytesToWrite);
    if (totalWritten <= 0) return 0;

    if (totalWritten === this.writeOffset) this.writeOffset = 0;
    else this.buffer.copyWithin(0, totalWritten, this.writeOffset), this.writeOffset -= totalWritten;
    return totalWritten;
  }
  /**
   * 将数据写入缓冲区，如果缓冲区数据加上新写入的数据超过阈值，则只写入部分数据，返回剩余数据，否则返回 null
   */
  setDataToThreshold(data: Uint8Array): Uint8Array | null {
    if (this.writeOffset >= this.callWriteThreshold) return data;
    const totalSize = this.writeOffset + data.byteLength;
    if (totalSize < this.callWriteThreshold) {
      this.buffer.set(data, this.writeOffset), this.writeOffset += data.byteLength;
      return null;
    }
    const bytesToBuffer = this.callWriteThreshold - this.writeOffset;
    this.buffer.set(data.subarray(0, bytesToBuffer), this.writeOffset), this.writeOffset += bytesToBuffer;
    return data.subarray(bytesToBuffer);
  }
  /**
   * 写入数据；达到阈值时发送缓冲数据，未达到阈值的尾部数据留在缓冲区，直到后续写入或 flush()。
   */
  async writeData(data: Uint8Array) {
    let rest: Uint8Array | null = data;
    do {
      rest = this.setDataToThreshold(rest);
      if (!rest) return;
      await this.transferBuffer(this.writeOffset - this.callWriteThreshold);
    } while (this.writeOffset > 0);

    while (rest.byteLength >= this.callWriteThreshold) {
      const written = await this.callWrite(rest);
      rest = rest.subarray(written);
    }
    if (rest.byteLength > 0) { // 这里 writeOffset 必定等于 0
      this.buffer.set(rest, 0), this.writeOffset = rest.byteLength;
    }
  }
}
