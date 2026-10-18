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

    this.flushThreshold = typeof flushThreshold === "number"
      ? Math.floor(flushThreshold)
      : Math.floor(writeBuffer.byteLength / 2);

    if (this.flushThreshold <= 0 || this.flushThreshold > writeBuffer.byteLength) {
      throw new Error("flushThreshold must be a positive integer and less than or equal to the buffer length.");
    }
    this.view = new DataView(writeBuffer.buffer, writeBuffer.byteOffset, writeBuffer.byteLength);
  }
  /**
   * 缓冲区数据达到此字节数时触发写入。空缓冲区中的大块数据可以绕过缓冲区直接写入。
   */
  private readonly flushThreshold: number;
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
  private async transferBuffer(minimumBytesToWrite: number) {
    let totalWritten = 0;
    while (totalWritten <= minimumBytesToWrite) {
      totalWritten += await this.callWrite(this.buffer.subarray(totalWritten, this.writeOffset));
    }
    if (totalWritten > 0) {
      if (totalWritten === this.writeOffset) {
        this.writeOffset = 0;
      } else {
        this.buffer.copyWithin(0, totalWritten, this.writeOffset);
        this.writeOffset -= totalWritten;
      }
    }
    return totalWritten;
  }
  async callOnce() {
    this.writeOffset -= await this.callWrite(this.buffer.subarray(0, this.writeOffset));
  }

  /**
   * 写入数据；达到阈值时发送缓冲数据，未达到阈值的尾部数据留在缓冲区，直到后续写入或 flush()。
   */
  async writeData(data: Uint8Array) {
    let pendingByteCount = data.byteLength + this.writeOffset;
    let inputOffset = 0;
    while (pendingByteCount >= this.flushThreshold) {
      if (this.writeOffset > 0) {
        const bytesToBuffer = Math.min(this.flushThreshold - this.writeOffset, data.byteLength);
        this.buffer.set(data.subarray(inputOffset, inputOffset + bytesToBuffer), this.writeOffset);
        inputOffset += bytesToBuffer;
        this.writeOffset += bytesToBuffer;
        pendingByteCount -= await this.transferBuffer(bytesToBuffer);
      } else {
        const written = await this.callWrite(data.subarray(inputOffset));
        inputOffset += written;
        pendingByteCount -= written;
      }
    }

    if (inputOffset < data.byteLength) {
      this.buffer.set(data.subarray(inputOffset), this.writeOffset);
      this.writeOffset += data.byteLength - inputOffset;
    }
  }
}

export abstract class BufferWriterQueue<T extends {}> {
  constructor(private onError: (error: unknown) => void, private onClear?: () => void) {
  }

  protected abstract flush(): Promise<void>;
  protected abstract get writeOffset(): number;
  protected abstract processItemWrite(item: Link<T>): Promise<void>;

  get queueHead(): T | undefined {
    return this.#head;
  }
  #head?: Link<T>;
  #tail?: Link<T>;
  length = 0;
  push(item: T): void {
    if (this.#tail) this.#tail.next = item;
    else this.#head = item;
    this.#tail = item;
    this.length++;

    if (this.pendingWrite) return;
    this.startWriteLoop();
  }
  shift() {
    this.#head = this.#head!.next;
    if (!this.#head) this.#tail = undefined;
    this.length--;
  }
  clear() {
    this.#head = undefined;
    this.#tail = undefined;
    this.length = 0;
  }

  /** 正在进行的写入操作的 Promise，如果没有正在进行的写入，则为 undefined */
  private pendingWrite?: Promise<void>;

  private startWriteLoop() {
    this.pendingWrite = this.handleWriteLoop().then(() => {
      if (this.#head) {
        this.startWriteLoop();
      } else {
        this.pendingWrite = undefined;
        this.onClear?.();
      }
    }, (error) => {
      this.clear();
      this.onError(error);
    });
  }

  private async handleWriteLoop() {
    let item = this.#head;
    while (item) {
      this.shift();
      await this.processItemWrite(item);
      item = this.#head;
    }
    if (this.writeOffset > 0) await this.flush();
  }

  *[Symbol.iterator](): Generator<T, void, void> {
    let item = this.#head;
    while (item) {
      yield item;
      item = item.next;
    }
  }
}
type Link<T extends {}> = T & {
  next?: Link<T>;
};

/**
 * 二进制缓冲区队列写入器。
 */
export class StreamWriter extends BufferWriterQueue<QueueItem> {
  constructor(
    private writer: BufferWriter,
    private onClose: () => Promise<void>,
    onError: (error: unknown) => void,
  ) {
    super(onError);
  }

  /**
   * 将字节块写入到写入队列中。数据在被写入到底层前，请勿修改 data 内容
   */
  pushData(data: Uint8Array): void {
    this.push({ type: QueueItemType.Data, data });
  }
  /**
   * 将写入操作添加到队列中。
   * @param getData 生成数据的函数。返回的数据在被写入到底层前，请勿修改其内容。
   */
  pushWrite(write: (writer: BufferWriter) => Promise<void>): void {
    this.push({ type: QueueItemType.WriteFn, write });
  }
  pushClose(): void {
    this.push({ type: QueueItemType.Close });
  }
  protected override flush(): Promise<void> {
    return this.writer.flush();
  }
  protected override get writeOffset(): number {
    return this.writer.writeOffset;
  }
  protected override async processItemWrite(item: QueueItem) {
    switch (item.type) {
      case QueueItemType.WriteFn:
        return item.write(this.writer);
      case QueueItemType.Data:
        return this.writer.writeData(item.data);
      case QueueItemType.Close:
        return this.onClose();
    }
  }
}

type QueueItem = WriteFnQueueItem | DataQueueItem | CloseQueueItem;

enum QueueItemType {
  WriteFn,
  Data,
  Close,
}

type WriteFnQueueItem = {
  type: QueueItemType.WriteFn;
  write: (writer: BufferWriter) => Promise<void>;
};

type DataQueueItem = {
  type: QueueItemType.Data;
  data: Uint8Array;
};
type CloseQueueItem = {
  type: QueueItemType.Close;
};
