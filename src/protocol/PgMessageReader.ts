import type { ByteStream } from "./ByteStream.ts";
import { PgProtocolError } from "./pg_message.ts";

/**
 * 已完成 PostgreSQL 普通消息编解码的客户端流。
 * @public
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
    try {
      await this.#stream.readInto(this.#header); // 5 bytes
    } catch (e) {
      this.#lock = false;
      throw e;
    }
    return new this.MessageReader(this, header[0]);
  }
  async write(buffer: Uint8Array): Promise<void> {
    await this.#stream.write(buffer);
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

  private MessageReader = class MessageReaderImpl implements Message {
    constructor(pgMessage: PgMessageReader, readonly type: number) {
      this.#pgMessage = pgMessage;
    }
    #pgMessage?: PgMessageReader;
    async readBody(): Promise<Uint8Array> {
      const pgMessage = this.#pgMessage;
      if (!pgMessage) throw new Error("MessageReader already read or consumed");
      this.#pgMessage = undefined;
      const header = pgMessage.#header;
      const length = new DataView(header.buffer, header.byteOffset, header.byteLength).getInt32(1);
      try {
        if (length < 4 || length > pgMessage.#maxMessageSize) {
          throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`, { messageCode: this.type });
        }

        return await pgMessage.#stream.read(length - 4);
      } finally {
        pgMessage.#lock = false;
      }
    }
    skip(): Promise<unknown> {
      return this.readBody();
    }
  };
}

/** @public */
export interface Message {
  readonly type: number;
  readBody(): Promise<Uint8Array>;
  skip(): Promise<unknown>;
}
