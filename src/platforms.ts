import type { ByteStream } from "@/protocol.ts";
import type { Duplex } from "node:stream";

const UnexpectedEofError = Deno.errors.UnexpectedEof;
export class DenoConnByteStream implements ByteStream {
  constructor(private conn: Deno.Conn) {}

  async read(byteLength: number): Promise<Uint8Array> {
    const data = new Uint8Array(byteLength);
    await this.readInto(data);
    return data;
  }

  async readInto(buffer: Uint8Array): Promise<void> {
    const bytesRead = await this.conn.read(buffer);
    if (bytesRead === null || bytesRead < buffer.length) throw new UnexpectedEofError();
    return;
  }

  write(buffer: Uint8Array): Promise<number> {
    return this.conn.write(buffer);
  }

  closeWrite(): Promise<void> {
    return this.closeWrite();
  }

  close(): void {
    this.conn.close();
  }
}

export declare class NodeDuplexByteStream implements ByteStream {
  constructor(duplex: Duplex);

  read(byteLength: number): Promise<Uint8Array>;
  readInto(buffer: Uint8Array): Promise<void>;
  write(buffer: Uint8Array): Promise<number>;
  closeWrite(): Promise<void>;
  close(): void;
}
