import { BufferWriter } from "./BufferWriter.ts";

export class BufferWriterQueue {
  constructor(writer: BufferWriter, private onClose: () => Promise<void>, private onError: (error: unknown) => void) {
    this.#writer = writer;
  }
  #writer: BufferWriter;

  #head?: Link<QueueItem>;
  #tail?: Link<QueueItem>;
  length = 0;
  private pushItem(item: QueueItem): void {
    if (this.#tail) this.#tail.next = item;
    else this.#head = item;
    this.#tail = item;
    this.length++;

    if (this.pendingWrite) return;
    this.startWriteLoop();
  }

  private shift() {
    this.#head = this.#head!.next;
    if (!this.#head) this.#tail = undefined;
    this.length--;
  }
  clear() {
    this.#head = undefined;
    this.#tail = undefined;
    this.length = 0;

    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = undefined;
      this.#writer.writeOffset = 0;
    }
  }

  pushEncoder(item: BufferEncoder): void {
    this.pushItem({ type: QueueItemType.Encoder, encoder: item });
  }
  /**
   * 将字节块写入到写入队列中。数据在被写入到底层前，请勿修改 data 内容
   */
  pushData(data: Uint8Array): void {
    this.pushItem({ type: QueueItemType.Data, data });
  }
  /**
   * 将写入操作添加到队列中。
   * @param getData 生成数据的函数。返回的数据在被写入到底层前，请勿修改其内容。
   */
  pushWrite(write: (writer: BufferWriter) => Promise<void>): void {
    this.pushItem({ type: QueueItemType.WriteFn, write });
  }
  pushClose() {
    return new Promise<void>((resolve, reject) => {
      this.pushItem({ type: QueueItemType.Close, resolve, reject });
    });
  }

  /** 正在进行的写入操作的 Promise，如果没有正在进行的写入，则为 undefined */
  private pendingWrite?: Promise<unknown> | undefined;
  private pendingFlush?: NodeJS.Timeout;

  private startWriteLoop() {
    if (this.pendingFlush) {
      clearTimeout(this.pendingFlush);
      this.pendingFlush = undefined;
    }
    this.handleWriteLoop();
  }
  private handleWriteLoop = (): void => {
    while (this.#head) {
      const item = this.#head;
      switch (item.type) {
        case QueueItemType.WriteFn:
          this.setPendingWrite(item.write(this.#writer));
          this.shift();
          return;
        case QueueItemType.Data: {
          const rest = this.#writer.setDataToThreshold(item.data);
          if (rest) {
            item.data = rest;
            this.setPendingWrite(this.#writer.transferBuffer());
            return;
          }
          this.shift();
          break;
        }
        case QueueItemType.Close: {
          const promise = this.#writer.writeOffset > 0 ? this.#writer.flush().then(this.onClose) : this.onClose();
          this.setPendingWrite(promise.then(item.resolve, item.reject));
          this.shift();
          return;
        }
        case QueueItemType.Encoder:
          if (item.encoder.encodeInto(this.#writer)) {
            if (this.#writer.writeOffset === 0) {
              this.pendingWrite = undefined;
              this.onError(new Error("Encoder requested more space without writing any bytes"));
              return;
            }
            this.setPendingWrite(this.#writer.transferBuffer());
            return;
          }
          this.shift();
          break;
        default:
          this.clear();
          this.onError(new Error(`Unknown queue item type: ${item}`));
          return;
      }
    }

    if (this.#writer.writeOffset > 0) {
      this.pendingFlush = setTimeout(() => {
        this.pendingFlush = undefined;
        this.setPendingWrite(this.#writer.flush());
      }, 0);
    }
    this.pendingWrite = undefined;
  };
  private onWriteError = (error: unknown) => {
    this.clear();
    this.onError(error);
  };

  private setPendingWrite(promise: Promise<unknown>) {
    this.pendingWrite = promise.then(this.handleWriteLoop, this.onWriteError);
  }
}
export interface BufferEncoder {
  /**
   * 返回 false, 编码结束，返回 true 表示缓冲区需要更多空间继续编码。
   * 应在缓冲区有足够空间时继续调用 encodeInto 继续编码
   */
  encodeInto(writer: BufferWriter): boolean | void;
}
type Link<T extends {} = {}> = T & {
  next?: Link<T>;
};

type QueueItem = WriteFnQueueItem | DataQueueItem | CloseQueueItem | EncodeQueueItem;

enum QueueItemType {
  Encoder,
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
  resolve: () => void;
  reject: (error: unknown) => void;
};
type EncodeQueueItem = {
  type: QueueItemType.Encoder;
  encoder: BufferEncoder;
};
