import type { Duplex } from "node:stream";
import type { ByteStream } from "@/interface/ByteStream.ts";
import { ByteBuffer, FixedBufferReader } from "@/_utils/DataBuffer.ts";
import { writeInto } from "@/_utils/ByteStream.ts";

export function createDuplexByteConnection(duplex: Duplex): ByteStream {
  return new NodeDuplexConnection(duplex);
}
class NodeDuplexConnection implements ByteStream {
  constructor(private duplex: Duplex) {
    if (duplex.readableFlowing !== false) duplex.pause();
    duplex.on("readable", () => {
      const item = this.#waiting;
      if (!item) return;
      const chunk = duplex.read(item.buffer.byteLength) as Uint8Array | null;
      if (chunk) {
        item.buffer.set(chunk);
        item.resolve(chunk.byteLength);
        this.#waiting = undefined;
      }
    });
    duplex.on("end", () => {
      const item = this.#waiting;
      if (!item) return;
      item.resolve(null);
      this.#waiting = undefined;
    });
    duplex.on("close", (err) => {
      const item = this.#waiting;
      if (!item) return;
      const error = err ?? new Error("Stream closed unexpectedly");
      item.reject(error);
      this.#waiting = undefined;
    });
  }
  close(): void {
    this.duplex.destroy();
  }
  write(p: Uint8Array): Promise<number> {
    const duplex = this.duplex;
    if (duplex.destroyed) return Promise.reject(duplex.errored ?? new Error("Writable stream has been destroyed"));
    // end() 后在 write 会抛出异常，所以无需额外处理
    return new Promise((resolve, reject) => {
      const byteLength = p.byteLength;
      duplex.write(p, (err: unknown) => {
        err ? reject(err) : resolve(byteLength);
      });
    });
  }
  closeWrite(): Promise<void> {
    const duplex = this.duplex;
    if (duplex.errored) return Promise.reject(duplex.errored);
    if (duplex.writableEnded) return Promise.resolve();
    return new Promise((resolve, reject) => {
      duplex.end((err: unknown) => {
        err ? reject(err) : resolve();
      });
    });
  }

  #waiting?: {
    resolve: (value: number | null) => void;
    reject: (reason?: any) => void;

    buffer: Uint8Array;
  };
  async read(p: Uint8Array): Promise<number | null> {
    const duplex = this.duplex;
    if (duplex.destroyed) throw duplex.errored ?? new Error("Readable stream has been destroyed");
    if (duplex.readableEnded) return null;
    if (this.#waiting) {
      throw new Error("Another read is already in progress");
    }

    const chunk = duplex.read(p.byteLength) as Uint8Array | null;
    if (chunk) {
      p.set(chunk);
      return chunk.byteLength;
    }

    return new Promise((resolve, reject) => {
      this.#waiting = { buffer: p, resolve, reject };
    });
  }
}

export class DenoBuffer extends FixedBufferReader implements ByteBuffer {
  constructor(private conn: Deno.Conn, bufferSize: number = 8 * 1024) {
    const buffer = new ArrayBuffer(bufferSize);
    const uint8Buffer = new Uint8Array(buffer);
    super(uint8Buffer);
    this.writerBuffer = new Uint8Array(bufferSize);
  }
  async start() {
    let size: number | null;
    do {
      size = await this.readInto();
      if (size === null) break;
    } while (true);
  }
  private async readInto(): Promise<number | null> {
    const size = await this.conn.read(this.getUnused());
    if (size === null) return null;
    else if (size) {
      this.offsetEnd += size;
      this.onData();
      this.gc();
    }
    return size;
  }
  readonly writerBuffer: Uint8Array;
  writerOffset: number = 0;
  onData() {
    throw new Error("No custom onData implementation provided");
  }
  onEnd() {
    throw new Error("No custom onEnd implementation provided");
  }
  write(data: Uint8Array): Promise<void> {
    return writeInto(this.conn, data);
  }
  closeWrite(): Promise<void> {
    return this.conn.closeWrite();
  }
}

export class NodeBuffer extends FixedBufferReader implements ByteBuffer {
  constructor(private duplex: Duplex, bufferSize: number = 8 * 1024) {
    const readerBuffer = new Uint8Array(bufferSize);
    super(readerBuffer);
    this.writerBuffer = new Uint8Array(bufferSize);
  }
  readonly writerBuffer: Uint8Array;
  writerOffset: number = 0;
  start() {
    this.duplex.on("data", (chunk) => {
      while (chunk.byteLength) {
        const length = this.buffer.byteLength - this.offsetEnd;
        this.buffer.set(chunk, this.offsetEnd);
        chunk = chunk.subarray(length);
        this.offsetEnd += length;
        this.onData();
        this.gc();
      }
    });
  }
  onData() {
    throw new Error("No custom onData implementation provided");
  }
  onEnd() {
    throw new Error("No custom onEnd implementation provided");
  }
  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.duplex.write(data, (err: unknown) => {
        err ? reject(err) : resolve();
      });
    });
  }
  closeWrite(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.duplex.end((err: unknown) => {
        err ? reject(err) : resolve();
      });
    });
  }
}
