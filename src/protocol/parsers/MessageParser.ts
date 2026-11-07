import { StreamReader } from "@/_utils/StreamReader.ts";
import { InternalError, PgProtocolError } from "@/_utils/error.ts";

export interface MessageParser<T = unknown> {
  next(reader: StreamReader, remainingByteLength: number): T | undefined;
  reset(): void;
}

const EMPTY_BODY = new Uint8Array(0);
export class MessageParsers {
  constructor(readonly maxHeaderLength: number) {
  }
  private readonly parsers: Record<number, MessageParser | undefined> = {};
  private readonly onFinishMap: Record<number, ((body: Uint8Array) => void) | undefined> = {};
  setFullParser(type: number, onFinish: (body: Uint8Array) => void): void {
    this.parsers[type] = new MessageFullParser(onFinish);
  }
  set(type: number, parser: MessageParser | MessageParser["next"], onFinish?: () => void): void {
    if (typeof parser === "function") {
      parser = { next: parser, reset() {} };
    }
    this.parsers[type] = parser;
    this.onFinishMap[type] = onFinish;
  }
  private type: number = -1;
  private remainingByteLength = 0;
  private readonly ignoreParser: MessageParser = {
    next(reader, remainingByteLength) {
      const length = Math.min(reader.readableLength, remainingByteLength);
      reader.readableStart += length;
    },
    reset() {},
  };
  private parser?: MessageParser;
  /** 如果 next 出错，需要重新初始化 MessageParsers，才能继续正确解析消息 */
  next(reader: StreamReader) {
    while (reader.readableLength) {
      if (!this.parser) {
        if (reader.readableLength < 5) return;

        const type = reader.view.getUint8(reader.readableStart);
        reader.readableStart++;
        this.remainingByteLength = decodeMessageLength(reader, this.maxHeaderLength) - 4;
        if (this.remainingByteLength === 0) {
          const parser = this.parsers[type];
          parser?.next(reader, 0);
          parser?.reset();
          this.onFinishMap[type]?.(EMPTY_BODY);
          continue;
        }
        this.type = type;
        this.parser = this.parsers[type] ?? this.ignoreParser;
      }
      const start = reader.readableStart;
      this.parser.next(reader, this.remainingByteLength);
      const consumed = reader.readableStart - start;
      if (consumed > this.remainingByteLength) {
        throw new PgProtocolError("Message parser consumed bytes beyond the message body");
      }
      if (consumed <= 0) {
        if (reader.readableLength === reader.buffer.byteLength) {
          throw new InternalError("Buffer size cannot satisfy message parsing requirement"); // 缓冲区大小无法满足消息解析需求
        }
        return;
      }
      this.remainingByteLength -= consumed;
      if (this.remainingByteLength === 0) {
        this.parser.reset();
        this.onFinishMap[this.type]?.(EMPTY_BODY);
        this.parser = undefined;
      }
    }
  }
}

function decodeMessageLength(reader: StreamReader, maxLength: number) {
  const messageLength = reader.view.getUint32(reader.readableStart);
  reader.readableStart += 4;
  if (messageLength < 4) {
    throw new PgProtocolError(`Invalid PostgreSQL message length: ${messageLength}`);
  }
  if (messageLength > maxLength) {
    throw new Error(`PostgreSQL message length exceeds the maximum allowed size: ${messageLength}`);
  }
  return messageLength;
}

class MessageFullParser implements MessageParser {
  constructor(public onFinish?: (body: Uint8Array) => void) {
  }
  private bodyChunks?: Uint8Array;
  reset(): void {
    this.bodyChunks = undefined;
  }
  next(reader: StreamReader, remainingByteLength: number): void {
    const readableLength = reader.readableLength;

    if (readableLength >= remainingByteLength && !this.bodyChunks) {
      const body = reader.buffer.slice(reader.readableStart, reader.readableStart + remainingByteLength);
      reader.readableStart += remainingByteLength;
      this.onFinish?.(body);
      return;
    }

    if (readableLength === 0) return;

    this.bodyChunks ??= new Uint8Array(remainingByteLength);
    const chunkLength = Math.min(readableLength, remainingByteLength);
    const offset = this.bodyChunks.byteLength - remainingByteLength;
    const chunk = reader.buffer.slice(reader.readableStart, reader.readableStart + chunkLength);
    reader.readableStart += chunkLength;
    this.bodyChunks.set(chunk, offset);
    remainingByteLength -= chunkLength;
    if (remainingByteLength > 0) return;

    const body = this.bodyChunks;
    this.bodyChunks = undefined;

    this.onFinish?.(body);
  }
}
