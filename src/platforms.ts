import type { ByteStream } from "@/protocol.ts";
import { Duplex } from "node:stream";

const UnexpectedEofError = Deno.errors.UnexpectedEof;
/** @public */
export class DenoConnByteStream implements ByteStream {
  constructor(private conn: Deno.Conn) {}

  async read(byteLength: number): Promise<Uint8Array> {
    const data = new Uint8Array(byteLength);
    await this.readInto(data);
    return data;
  }

  async readInto(buffer: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < buffer.byteLength) {
      const bytesRead = await this.conn.read(buffer.subarray(offset));
      if (bytesRead === null) throw new UnexpectedEofError();
      offset += bytesRead;
    }
  }

  write(buffer: Uint8Array): Promise<number> {
    return this.conn.write(buffer);
  }

  closeWrite(): Promise<void> {
    return this.conn.closeWrite();
  }

  close(): void {
    this.conn.close();
  }
}

/** @public */
export class NodeDuplexByteStream implements ByteStream {
  constructor(private duplex: Duplex) {
    const { readable, writable } = Duplex.toWeb(this.duplex);
    this.#reader = readable.getReader();
    this.#writer = writable.getWriter();
  }
  #reader: ReadableStreamDefaultReader<Uint8Array>;
  #writer: WritableStreamDefaultWriter<Uint8Array>;

  async read(byteLength: number): Promise<Uint8Array> {
    const buffer = new Uint8Array(byteLength);
    await this.readInto(buffer);
    return buffer;
  }
  #rest: Uint8Array | null = null;
  async readInto(buffer: Uint8Array): Promise<void> {
    const total = buffer.byteLength;
    let offset = 0;
    if (this.#rest) {
      const result = this.#setData(buffer, offset, this.#rest);
      offset = result.offset;
      this.#rest = result.rest;
    }
    if (offset >= total) return;

    let res: ReadableStreamReadResult<Uint8Array> | undefined;
    do {
      res = await this.#reader.read();
      if (res.done) throw new UnexpectedEofError();
      const result = this.#setData(buffer, offset, res.value);
      offset = result.offset;
      this.#rest = result.rest;
    } while (offset < total);
    buffer.set(res.value);
  }
  #setData(buffer: Uint8Array, offset: number, rest: Uint8Array): { rest: Uint8Array | null; offset: number } {
    if (rest.byteLength > buffer.byteLength) {
      buffer.set(rest.subarray(0, buffer.byteLength));
      return { rest: rest.subarray(buffer.byteLength), offset: buffer.byteLength };
    } else if (rest.byteLength === buffer.byteLength) {
      buffer.set(rest, offset);
      return { rest: null, offset: buffer.byteLength };
    } else {
      buffer.set(rest, offset);
      offset += rest.byteLength;
      return { rest: null, offset };
    }
  }

  async write(buffer: Uint8Array): Promise<number> {
    await this.#writer.write(buffer);
    return buffer.byteLength;
  }
  closeWrite(): Promise<void> {
    return this.#writer.close();
  }
  close(): void {
    this.duplex.destroy();
  }
}
