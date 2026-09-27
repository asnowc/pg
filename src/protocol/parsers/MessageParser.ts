import { StreamReader } from "@/_utils/StreamReader.ts";
import { PgProtocolError } from "@/_utils/error.ts";

export interface MessageParser {
  get resetByteLength(): number;
  start(bodyLength: number): void;
  next(reader: StreamReader): void;
}
const EMPTY_BODY = new Uint8Array(0);
export class MessageParsers {
  constructor(readonly maxHeaderLength: number) {
  }
  private parsers: Record<number, MessageParser | ((body: Uint8Array) => void) | undefined> = {};
  set(type: number, parser: MessageParser | ((body: Uint8Array) => void) | undefined) {
    this.parsers[type] = parser;
  }

  private fullParser = new MessageFullParser();
  readonly ignoreParser = new MessageIgnoreParser();
  private parser?: MessageParser;
  next(reader: StreamReader) {
    while (reader.readableLength) {
      if (!this.parser) {
        if (reader.readableLength < 5) return;

        const type = reader.readUInt8();
        const bodyLength = decodeMessageLength(reader, this.maxHeaderLength) - 4;
        let parser = this.parsers[type] ?? this.ignoreParser;
        if (typeof parser === "function") {
          this.fullParser.onFinish = parser;
          if (bodyLength === 0) {
            parser(EMPTY_BODY);
            continue;
          } else {
            this.fullParser.onFinish = parser;
            parser = this.fullParser;
          }
        }
        this.parser = parser;
        parser.start(bodyLength);
      }
      this.parser.next(reader);
      if (this.parser.resetByteLength === 0) this.parser = undefined;
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
  /** 消息剩余的字节数 */
  resetByteLength = 0;
  private bodyChunks?: Uint8Array;
  start(bodyLength: number): void {
    this.resetByteLength = bodyLength;
    this.bodyChunks = undefined;
  }
  next(reader: StreamReader): void {
    const readableLength = reader.readableLength;

    if (readableLength >= this.resetByteLength && !this.bodyChunks) {
      const body = reader.copyBinary(this.resetByteLength);
      this.resetByteLength = 0;
      this.onFinish?.(body);
      return;
    }

    if (readableLength === 0) return;

    this.bodyChunks ??= new Uint8Array(this.resetByteLength);
    const chunkLength = Math.min(readableLength, this.resetByteLength);
    const offset = this.bodyChunks.byteLength - this.resetByteLength;
    this.bodyChunks.set(reader.copyBinary(chunkLength), offset);
    this.resetByteLength -= chunkLength;
    if (this.resetByteLength > 0) return;

    const body = this.bodyChunks;
    this.bodyChunks = undefined;
    this.resetByteLength = 0;

    this.onFinish?.(body);
  }
}

class MessageIgnoreParser implements MessageParser {
  resetByteLength = 0;
  start(bodyLength: number): void {
    this.resetByteLength = bodyLength;
  }
  next(reader: StreamReader): void {
    const length = Math.min(reader.readableLength, this.resetByteLength);
    reader.readBinary(length);
    this.resetByteLength -= length;
  }
}
