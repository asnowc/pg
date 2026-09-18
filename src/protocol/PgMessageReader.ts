import type { AsyncReader, AsyncWriter, ByteStream } from "@/interface/ByteStream.ts";
import { readInto, readLength, skipData, writeInto } from "@/_utils/ByteStream.ts";
import { PgProtocolError } from "@/error.ts";
import { BackendMessageCode, encodeTerminateMessage } from "@/protocol.ts";
import type { PgSessionInfo } from "@/interface/protocol.ts";
import { decodeInt32BE } from "@/_utils/number.ts";

/**
 * 已完成 PostgreSQL 普通消息编解码的客户端流。
 */
export class PgSession {
  constructor(
    stream: ByteStream,
    readonly sessionInfo: Readonly<PgSessionInfo>,
    maxMessageSize = Message.DEFAULT_MAX_MESSAGE_SIZE,
  ) {
    if (!Number.isSafeInteger(maxMessageSize) || maxMessageSize < 4) {
      throw new RangeError("maxMessageSize must be an integer greater than or equal to 4");
    }
    this.#stream = stream;
    this.maxMessageSize = maxMessageSize;
    const header = new Uint8Array(5);
    this.#header = header;
    this.#headerView = new DataView(header.buffer, header.byteOffset, header.byteLength);
    this.finish = this.#start().catch(() => {});
  }
  #stream: ByteStream;
  maxMessageSize: number;
  /** 提前分配的缓冲区读取消息头，避免每次都创建新数组。 */
  #header: Uint8Array;
  #headerView: DataView;
  async #start() {
    let message = await this.read();
    while (message) {
      this.#queryListener?.(message);
      message = await this.read();
    }
  }
  #onMessage(info: Message) {
    switch (info.type) {
      case BackendMessageCode.NoticeResponse:
        break;
      case BackendMessageCode.NotificationResponse:
        break;
      case BackendMessageCode.ReadyForQuery:
        break;
      default:
        break;
    }
  }

  /** 前一次读取返回结果前不得再次调用；*/
  async read(): Promise<Message | null> {
    const stream = this.#stream;
    await readInto(stream, this.#header); // 5 bytes
    const type = this.#header[0];
    const length = this.#headerView.getInt32(1);
    if (length < 4 || length > this.maxMessageSize) {
      stream.close();
      throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`, { messageCode: type });
    }
    return new Message(stream, type, length - 4);
  }

  #queryListener?: (info: Message) => Promise<void>;

  async write(...args: Uint8Array[]): Promise<void>;
  async write(): Promise<void> {
    for (let i = 0; i < arguments.length; i++) {
      await writeInto(this.#stream, arguments[i]);
    }
  }
  /** 如果为 true , 则不可在进行写入操作 */
  isCloseCalled: boolean = false;
  readonly finish: Promise<void>;

  async #safeClose(): Promise<void> {
    const stream = this.#stream;
    await writeInto(stream, encodeTerminateMessage());
    await stream.closeWrite();
  }
  async close(): Promise<void> {
    if (this.isCloseCalled) return this.finish;
    this.isCloseCalled = true;
    const stream = this.#stream;
    try {
      await this.#safeClose();
    } catch {
      stream.close();
    }
    return this.finish;
  }
  destroy() {
    this.isCloseCalled = true;
    this.#stream.close();
  }
}

export class Message implements AsyncReader, AsyncWriter {
  static readonly DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;
  static async read(stream: ByteStream, header: Uint8Array): Promise<Message | null> {
    await readInto(stream, header); // 5 bytes
    const type = header[0];
    const length = decodeInt32BE(header, 1);
    if (length < 4 || length > Message.DEFAULT_MAX_MESSAGE_SIZE) {
      stream.close();
      throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`, { messageCode: type });
    }
    return new Message(stream, type, length - 4);
  }
  constructor(readonly stream: ByteStream, readonly type: number, bodyLength: number) {
    this.bodyLength = bodyLength;
  }
  bodyLength: number;
  read(data: Uint8Array): Promise<number | null> {
    return this.stream.read(data);
  }
  write(data: Uint8Array): Promise<number> {
    return this.stream.write(data);
  }
  closeWrite(): Promise<void> {
    return this.stream.closeWrite();
  }
  readBody(): Promise<Uint8Array> {
    return readLength(this.stream, this.bodyLength);
  }
  skip(): Promise<void> {
    return skipData(this.stream, this.bodyLength);
  }
}
