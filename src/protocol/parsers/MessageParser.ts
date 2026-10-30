import { StreamReader } from "@/_utils/StreamReader.ts";
import { InternalError, PgProtocolError } from "@/_utils/error.ts";

export interface MessageParser<T = unknown> {
  next(reader: StreamReader, remainingByteLength: number): T | undefined;
  reset(): void;
}
export function createMessageParser<T>(next: MessageParser<T>["next"], onFinish?: (body: T) => void): MessageParser<T> {
  return {
    next,
    reset() {},
  };
}
const EMPTY_BODY = new Uint8Array(0);
export class MessageParsers {
  constructor(readonly maxHeaderLength: number) {
  }
  private readonly parsers: Record<number, MessageParser | undefined> = {};
  private readonly onFinishMap: Record<number, ((body: Uint8Array) => void) | undefined> = {};
  set<T>(type: number, parser: MessageParser<T> | ((body: Uint8Array) => void), onFinish?: () => void): void;
  set(type: number, parser: MessageParser<any> | ((body: Uint8Array) => void), onFinish?: () => void): void {
    if (typeof parser === "function") {
      this.onFinishMap[type] = parser;
      parser = this.fullParser;
    } else this.parsers[type] = parser;
    if (onFinish) this.onFinishMap[type] = onFinish;
  }
  private type: number = -1;
  private remainingByteLength = 0;
  private readonly fullParser = new MessageFullParser();
  private readonly ignoreParser: MessageParser = {
    next(reader, remainingByteLength) {
      const length = Math.min(reader.readableLength, remainingByteLength);
      reader.readBinary(length);
    },
    reset() {},
  };
  private parser?: MessageParser;
  /** 如果 next 出错，需要重新初始化 MessageParsers，才能继续正确解析消息 */
  next(reader: StreamReader) {
    while (reader.readableLength) {
      if (!this.parser) {
        if (reader.readableLength < 5) return;

        const type = reader.readUInt8();
        this.remainingByteLength = decodeMessageLength(reader, this.maxHeaderLength) - 4;
        if (this.remainingByteLength === 0) {
          this.onFinishMap[type]?.(EMPTY_BODY);
          continue;
        }
        this.type = type;
        this.parser = this.parsers[type] ?? this.ignoreParser;
      }
      const start = reader.readableStart;
      this.parser.next(reader, this.remainingByteLength);
      const consumed = reader.readableStart - start;
      if (consumed <= 0) {
        if (reader.readableLength === reader.buffer.byteLength) {
          throw new InternalError("Buffer size cannot satisfy message parsing requirement"); // 缓冲区大小无法满足消息解析需求
        }
        return;
      }
      this.remainingByteLength -= consumed;
      if (this.remainingByteLength === 0) {
        this.onFinishMap[this.type]?.(EMPTY_BODY);
        this.parser = undefined;
      }
    }
  }
}

function decodeMessageLength(reader: StreamReader, maxLength: number) {
  const messageLength = reader.readUInt32BE();
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
      const body = reader.slice(remainingByteLength);
      this.onFinish?.(body);
      return;
    }

    if (readableLength === 0) return;

    this.bodyChunks ??= new Uint8Array(remainingByteLength);
    const chunkLength = Math.min(readableLength, remainingByteLength);
    const offset = this.bodyChunks.byteLength - remainingByteLength;
    this.bodyChunks.set(reader.slice(chunkLength), offset);
    remainingByteLength -= chunkLength;
    if (remainingByteLength > 0) return;

    const body = this.bodyChunks;
    this.bodyChunks = undefined;

    this.onFinish?.(body);
  }
}
