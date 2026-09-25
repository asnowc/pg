import { StreamParser, StreamReader } from "@/_utils/StreamReader.ts";
import { PgProtocolError } from "@/_utils/error.ts";

export interface MessageParser<T> {
  next(reader: StreamReader, type: number, bodyLength: number): T | undefined;
  onDone(result: T): void;
}

/**
 * 解析完整的 PostgreSQL 消息主体的 Uint8Array。
 */
export class MessageFullParser implements StreamParser<Uint8Array> {
  constructor(bodyLength: number, readonly onDone?: (result: Uint8Array) => void) {
    this.restBodyLength = bodyLength;
  }
  /** 消息剩余的字节数 */
  private restBodyLength: number;
  private bodyChunks?: Uint8Array;
  next(reader: StreamReader): Uint8Array | undefined {
    if (this.restBodyLength === 0) return;
    const readableLength = reader.readableLength;

    if (readableLength >= this.restBodyLength && !this.bodyChunks) {
      const body = reader.copyBinary(this.restBodyLength);
      this.restBodyLength = 0;
      return body;
    }

    if (readableLength === 0) return;

    this.bodyChunks ??= new Uint8Array(this.restBodyLength);
    const chunkLength = Math.min(readableLength, this.restBodyLength);
    const offset = this.bodyChunks.byteLength - this.restBodyLength;
    this.bodyChunks.set(reader.copyBinary(chunkLength), offset);
    this.restBodyLength -= chunkLength;
    if (this.restBodyLength > 0) return;

    const body = this.bodyChunks;
    this.bodyChunks = undefined;
    this.restBodyLength = 0;
    this.onDone?.(body);
    return body;
  }
}
export function checkMessageLength(length: number, maxLength: number) {
  if (length < 4) {
    throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`);
  }
  if (length > maxLength) {
    throw new Error(`PostgreSQL message length exceeds the maximum allowed size: ${length}`);
  }
}
