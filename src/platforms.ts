import { Duplex } from "node:stream";
import type { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { InternalError } from "@/_utils/error.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { BufferWriter, BufferWriterFunction, BufferWriterWriteInto } from "@/_utils/StreamWriter.ts";
import type { PrunedDenoConn } from "@/interface/Connection.ts";

interface PipeStreamOptions {
  writerBufferSize?: number;
  readerBufferSize?: number;
}
export class DenoBufferStream extends BufferReader implements ConnectionStream {
  constructor(private conn: PrunedDenoConn, options: PipeStreamOptions = {}) {
    const { readerBufferSize = 8 * 1024, writerBufferSize = 8 * 1024 } = options;
    super(new Uint8Array(readerBufferSize));
    this.writer = new BufferWriter(new Uint8Array(writerBufferSize), (data) => this.conn.write(data), this.#onError);
  }
  #onError = (err: unknown) => {
    this.onError?.(err);
    this.destroy();
  };
  onError?: (error: unknown) => void;
  async startReadLoop(onData: () => boolean | void, onEnd: () => void) {
    this.#startReadLoop(onData, onEnd).catch(this.#onError);
    return;
  }
  async #startReadLoop(onData: () => boolean | void, onEnd: () => void) {
    let isEnd: boolean | void | undefined;
    let size: number | null;
    do {
      this.gc();
      const chunk = this.buffer.subarray(this.readerBufferWriteOffset);
      if (chunk.byteLength === 0) {
        throw new InternalError("The BufferReader did not read any data when the onData method was called");
      }
      size = await this.conn.read(chunk);
      if (size === null) return onEnd();
      if (size === 0) continue;

      this.readerBufferWriteOffset += size;
      isEnd = onData();
    } while (!isEnd);
  }

  private readonly writer: BufferWriter;
  pushData(data: Uint8Array): void {
    return this.writer.pushData(data);
  }
  pushWrite(write: BufferWriterFunction): void {
    return this.writer.pushWrite(write);
  }
  pushWriteInto(onWriteInto: BufferWriterWriteInto): void {
    return this.writer.pushWriteInto(onWriteInto);
  }
  closeWrite(): Promise<void> {
    return this.conn.closeWrite();
  }
  private destroyed = false;
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    try {
      this.conn.close();
    } catch {
      // The socket may already be closed after EOF.
    }
  }
}

export class NodeBufferStream extends BufferReader implements ConnectionStream {
  constructor(private duplex: Duplex, options: PipeStreamOptions = {}) {
    const { readerBufferSize = 8 * 1024, writerBufferSize = 8 * 1024 } = options;
    super(new Uint8Array(readerBufferSize));
    this.writer = new BufferWriter(
      new Uint8Array(writerBufferSize),
      (data) => {
        return new Promise<number>((resolve, reject) => {
          this.duplex.write(data, (err) => {
            err ? reject(err) : resolve(data.byteLength);
          });
        });
      },
      (err) => {
        this.onError?.(err);
        this.destroy();
      },
    );
  }

  private onDataNotice: () => boolean | void = noListener;
  private onEnd: () => void = noListener;
  onError?: (error: unknown) => void;
  startReadLoop(onData: () => boolean | void, onEnd: () => void): void {
    this.onDataNotice = onData;
    this.onEnd = onEnd;
    const rest = this.rest;
    if (rest) {
      this.rest = undefined;
      if (this.onData(rest)) return;
    }
    this.duplex.on("data", this.onData);
    this.duplex.on("end", this.onEnd);
  }
  /**
   * 如果返回 true ，表示暂停处理数据；如果返回 false ，表示继续处理数据。
   */
  private onData = (chunk: Uint8Array): boolean => {
    while (chunk.byteLength) {
      this.gc();
      const length = this.pushReaderBufferData(chunk);
      chunk = chunk.subarray(length);

      let shouldStop = false;
      while (true) {
        const readableLength = this.readableLength;
        if (this.onDataNotice()) {
          shouldStop = true;
          break;
        }
        if (this.readableLength === readableLength) break;
      }
      if (shouldStop) {
        if (chunk.byteLength) {
          this.rest = chunk;
        }
        this.duplex.off("data", this.onData);
        this.duplex.off("end", this.onEnd);
        this.onDataNotice = noListener;
        return true;
      }
    }
    return false;
  };
  private rest?: Uint8Array;

  private readonly writer: BufferWriter;
  pushData(data: Uint8Array): void {
    return this.writer.pushData(data);
  }
  pushWrite(write: BufferWriterFunction): void {
    return this.writer.pushWrite(write);
  }
  pushWriteInto(onWriteInto: BufferWriterWriteInto): void {
    return this.writer.pushWriteInto(onWriteInto);
  }

  closeWrite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.duplex.end((err: unknown) => {
        err ? reject(err) : resolve();
      });
    });
  }
  destroy(): void {
    this.duplex.destroy();
  }
}
function noListener(): never {
  throw new Error("Internal Error: No listener provided");
}
