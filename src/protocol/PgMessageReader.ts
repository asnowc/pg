import type { ByteStream } from "@/interface/Connection.ts";
import { disposeByteStreamData } from "@/_utils/ByteStream.ts";
import { PgProtocolError } from "@/error.ts";

/**
 * 已完成 PostgreSQL 普通消息编解码的客户端流。
 */
export class PgMessageReader {
  constructor(stream: ByteStream, maxMessageSize = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxMessageSize) || maxMessageSize < 4) {
      throw new RangeError("maxMessageSize must be an integer greater than or equal to 4");
    }
    this.#stream = stream;
    this.#maxMessageSize = maxMessageSize;
  }
  #stream: ByteStream;
  #maxMessageSize: number;
  #lock = false;
  /** 提前分配的缓冲区读取消息头，避免每次都创建新数组。 */
  #header = new Uint8Array(5);

  /** 前一次读取返回结果前不得再次调用；*/
  async read(): Promise<Message | null> {
    if (this.#lock) throw new Error("Previous read not finished");
    this.#lock = true;
    const header = this.#header;
    await this.#stream.readInto(this.#header); // 5 bytes
    const type = header[0];
    const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getInt32(1);
    if (length < 4 || length > this.#maxMessageSize) {
      this.#stream.close();
      throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`, { messageCode: type });
    }
    return new PgMessageReader.MessageReader(this, type, length - 4);
  }
  write(buffer: Uint8Array): Promise<void> {
    return this.#stream.write(buffer);
  }
  async close(): Promise<void> {
    if (this.#lock) throw new Error("Cannot close while a read is in progress");
    const stream = this.#stream;
    //TODO
    try {
      await stream.closeWrite();
    } finally {
      await stream.close();
    }
  }

  private static MessageReader = class MessageReaderImpl implements Message {
    constructor(pgMessage: PgMessageReader, readonly type: number, readonly bodyLength: number) {
      this.#pgMessage = pgMessage;
    }
    #pgMessage?: PgMessageReader;
    #getReader() {
      const pgMessage = this.#pgMessage;
      if (!pgMessage) throw new Error("MessageReader already read or consumed");
      this.#pgMessage = undefined;
      return pgMessage;
    }
    async readBody(): Promise<Uint8Array> {
      const pgMessage = this.#getReader();
      const body = await pgMessage.#stream.read(this.bodyLength);
      pgMessage.#lock = false;
      return body;
    }
    async skip(): Promise<void> {
      const pgMessage = this.#getReader();
      await disposeByteStreamData(pgMessage.#stream, this.bodyLength, MAX_CHUNK_SIZE);
      pgMessage.#lock = false;
    }
    async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
      const pgMessage = this.#getReader();
      const stream = pgMessage.#stream;

      let length = this.bodyLength;

      while (length > 0) {
        const chunkSize = length > MAX_CHUNK_SIZE ? MAX_CHUNK_SIZE : length;
        const chunk = await stream.read(chunkSize);
        length -= chunk.byteLength;
        yield chunk;
      }
      pgMessage.#lock = false;
    }
  };
}
const MAX_CHUNK_SIZE = 1024 * 1024;

export interface Message {
  readonly type: number;
  readBody(): Promise<Uint8Array>;
  skip(): Promise<unknown>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
}
