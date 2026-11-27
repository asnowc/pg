import type { DataStream } from "@/internal/DataStream.ts";
import { InternalError } from "@/internal/error.ts";
import { type ReadableBuffer, ReadBuffer } from "@/internal/ReadBuffer.ts";
import { WriteBuffer } from "@/internal/WriterBuffer.ts";
import type { NetConn } from "@/interface/Connection.ts";

export class NetConnBufferStream extends WriteBuffer implements DataStream {
  constructor(
    private conn: NetConn,
    options: { readBufferSize?: number; writeBufferSize?: number } = {},
  ) {
    super((data) => this.conn.write(data), options.writeBufferSize ?? 16 * 1024);
    this.reader = new ReadBuffer(new Uint8Array(options.readBufferSize ?? 16 * 1024));
  }
  private readonly reader: ReadBuffer;
  #onError = (err: unknown) => {
    if (this.onError) this.onError(err instanceof Error ? err : new Error(String(err)));
    else console.error(new InternalError("Unhandled error in DenoBufferStream"));
    this.destroy();
  };
  private onError?: (error: Error) => void;
  listenOnError(onError?: (error: Error) => void): void {
    if (onError && this.onError) throw new InternalError("Error listener already set");
    this.onError = onError;
  }
  startReadLoop(onData: (buffer: ReadableBuffer) => boolean | void, onEnd: () => void) {
    this.#startReadLoop(onData, onEnd).catch(this.#onError);
    return;
  }
  async #startReadLoop(onData: (buffer: ReadableBuffer) => boolean | void, onEnd: () => void) {
    const reader = this.reader;
    let isEnd: boolean | void | undefined;
    let size: number | null;
    do {
      reader.compact();
      const chunk = reader.buffer.subarray(reader.readableEnd);
      if (chunk.byteLength === 0) {
        throw new InternalError("The BufferReader did not read any data when the onData method was called");
      }
      size = await this.conn.read(chunk);
      if (size === null) return onEnd();
      if (size === 0) continue;

      reader.readableEnd += size;
      isEnd = onData(reader);
    } while (!isEnd);
  }

  async closeWrite(): Promise<void> {
    await this.flush();
    await this.conn.closeWrite();
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
