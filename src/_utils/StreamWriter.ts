/**
 * 二进制缓冲区队列写入器。
 */
export interface StreamWriter {
  /**
   * 将字节块写入到写入队列中。数据在被写入到底层前，请勿修改 data 内容
   */
  pushData(data: Uint8Array): void;
  /**
   * 将写入操作添加到队列中。
   * @param getData 生成数据的函数。返回的数据在被写入到底层前，请勿修改其内容。
   */
  pushWrite(write: BufferWriterFunction): void;
  /**
   * 将写入操作添加到队列中。
   * @param onWriteInto 调用时，会把写入缓冲区和偏移量传入. 可用缓冲区大小可能为 0
   */
  pushWriteInto(onWriteInto: BufferWriterWriteInto): void;
}
export type BufferWriterWriteIntoResult = {
  /** written 必须是正整数 */
  written: number;
  done?: boolean;
};

export interface BufferWriterWriteInto {
  /**
   * @param offset buffer 从 offset 到末尾为可写入空间（offset 小于等于 buffer.byteLength）。
   * 返回 null 表示没有写入任何数据，返回 BufferWriterWriteIntoResult 表示写入了数据。
   */
  (buffer: Uint8Array, offset: number): null | BufferWriterWriteIntoResult | Promise<BufferWriterWriteIntoResult>;
}
export type BufferWriterFunction = () => Promise<Uint8Array> | Uint8Array;

export class BufferWriter implements StreamWriter {
  constructor(
    buffer: Uint8Array,
    private callWrite: (buffer: Uint8Array) => Promise<number>,
    private onError: (error: unknown) => void,
  ) {
    this.buffer = buffer;
    this.flushThreshold = Math.floor(buffer.byteLength / 2);
  }
  /**
   * 调用 callWrite 的字节大小阈值。正整数
   */
  private readonly flushThreshold: number;
  private readonly buffer: Uint8Array;
  private bufferedLength: number = 0;

  /** 可写入到 FixedBufferWriter 的字节长度 */
  get writableLength(): number {
    return this.buffer.byteLength - this.bufferedLength;
  }

  private queueHead?: QueueItem;
  private queueTail?: QueueItem;
  private enqueue(item: QueueItem): void {
    if (this.queueTail) this.queueTail.next = item;
    else this.queueHead = item;
    this.queueTail = item;
  }

  /** 正在进行的写入操作的 Promise，如果没有正在进行的写入，则为 undefined */
  private pendingWrite?: Promise<void>;
  private flushTimer?: NodeJS.Timeout;

  pushData(data: Uint8Array): void {
    const item: QueueItem = { type: "data", data };
    if (this.pendingWrite) return this.enqueue(item);
    this.processItem(item);
  }
  pushWrite(write: BufferWriterFunction): void {
    const item: QueueItem = { type: "writeFn", write };
    if (this.pendingWrite) return this.enqueue(item);
    this.processItem(item);
  }
  pushWriteInto(onWriteInto: BufferWriterWriteInto): void {
    const item: QueueItem = { type: "writeInto", writeInto: onWriteInto };
    if (this.pendingWrite) return this.enqueue(item);
    this.processItem(item);
  }
  private onItemFinished = (): void => {
    this.pendingWrite = undefined;
    if (this.queueHead) {
      const item = this.queueHead;
      this.queueHead = item.next;
      if (!item.next) this.queueTail = undefined;
      this.processItem(item);
      return;
    }
    if (this.bufferedLength > 0 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = undefined;
        this.pendingWrite = this.flushBuffer(0).then(this.onItemFinished, this.onError);
      }, 0);
    }
    return;
  };
  private processItem(item: QueueItem) {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    let promise: Promise<void>;
    switch (item.type) {
      case "writeFn": {
        const data = item.write();
        if (data instanceof Promise) promise = data.then((data) => this.writeData(data));
        else promise = this.writeData(data);
        break;
      }
      case "writeInto":
        promise = this.writeInto(item.writeInto);
        break;
      case "data":
        promise = this.writeData(item.data);
        break;
    }

    this.pendingWrite = promise.then(this.onItemFinished, this.onError);
  }

  /**
   * 将数据写入缓冲区，如果缓冲区已满，则调用 startWrite 将数据写入到底层。
   */
  private async writeData(data: Uint8Array): Promise<void> {
    const bufferCapacity = this.buffer.byteLength;
    let dataOffset = 0;
    let remainingLength = this.bufferedLength + data.byteLength;
    while (remainingLength > this.flushThreshold) {
      if (this.bufferedLength === 0) {
        // 此时可以直接将数据写入到底层，而无需先写入缓冲区
        do {
          const written = await this.callWrite(data.subarray(dataOffset));
          dataOffset += written;
          remainingLength -= written;
        } while (remainingLength > this.flushThreshold);
        break;
      }
      const chunk = data.subarray(dataOffset, Math.min(data.byteLength, bufferCapacity - this.bufferedLength));
      this.buffer.set(chunk, this.bufferedLength);

      dataOffset += chunk.byteLength;
      this.bufferedLength += chunk.byteLength;

      const written = await this.callWrite(this.buffer.subarray(0, this.bufferedLength));
      this.buffer.copyWithin(0, written, this.bufferedLength);
      this.bufferedLength -= written;
      remainingLength -= written;
    }
    if (remainingLength > 0) {
      const chunk = data.subarray(dataOffset);
      this.buffer.set(chunk, this.bufferedLength);
      this.bufferedLength += chunk.byteLength;
    }
  }

  /**
   * 调用 writeInto  将数据写入缓存区，直到写入完成。
   * 当缓冲区不满足 writeInto 的写入需求时，会将缓冲区的数据写入到底层。
   * 如果缓冲区总大小不足以满足 writeInto 的写入需求，会抛出错误。
   */
  private async writeInto(writeInto: BufferWriterWriteInto): Promise<void> {
    let result: BufferWriterWriteIntoResult | null;
    let written = 0;
    do {
      result = await writeInto(this.buffer, this.bufferedLength);
      if (result === null) {
        if (this.bufferedLength === 0) throw new Error("Writer buffer is too small");

        written = await this.flushBuffer(this.flushThreshold);
        if (written === 0) written = await this.flushBuffer(0);
      } else if (result.written < 1) {
        throw new Error("writeInto did not write any data");
      } else {
        this.bufferedLength += result.written;
      }
    } while (result === null || !result.done);
  }

  /**
   *  将缓冲区的数据写入到底层，直到缓冲区的数据量小于指定的阈值。
   */
  private async flushBuffer(bufferThreshold: number): Promise<number> {
    const bufferedLength = this.bufferedLength;
    let writtenLength = 0;
    while (bufferedLength - writtenLength > bufferThreshold) {
      const written = await this.callWrite(this.buffer.subarray(writtenLength, bufferedLength));
      writtenLength += written;
    }
    this.buffer.copyWithin(0, writtenLength, bufferedLength);
    this.bufferedLength = bufferedLength - writtenLength;
    return writtenLength;
  }
}

type QueueItem = WriteFnQueueItem | WriteIntoQueueItem | DataQueueItem;
type WriteFnQueueItem = {
  type: "writeFn";
  write: BufferWriterFunction;
  next?: QueueItem;
};
type WriteIntoQueueItem = {
  type: "writeInto";
  writeInto: BufferWriterWriteInto;
  next?: QueueItem;
};
type DataQueueItem = {
  type: "data";
  data: Uint8Array;
  next?: QueueItem;
};
