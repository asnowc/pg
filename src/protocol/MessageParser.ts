import type { BufferReader, ByteChunkParser } from "@/_utils/DataBuffer.ts";

export interface MessageParser<T> extends ByteChunkParser<T> {
  type: number;
}

export class PgMessageFullParser implements MessageParser<Uint8Array> {
  constructor(readonly type: number) {
  }
  /** 消息剩余的字节数 */
  private bodyLength?: number;
  /** 拿到的 Uint8Array 必须立即消费，否则可能会被覆盖 */
  next(reader: BufferReader): Uint8Array | undefined {
    if (this.bodyLength === undefined) {
      if (reader.readerLength < 4) return;
      this.bodyLength = reader.readInt32BE() - 4;
    }
    const readableLength = reader.readerLength;

    if (readableLength >= this.bodyLength) {
      if (!this.bodyChunks) return reader.readBinary(this.bodyLength); // 这里导致返回的 Uint8Array 必须立即消费，否则可能会被覆盖
    }

    let offset: number;
    if (this.bodyChunks) offset = this.bodyChunks.byteLength - this.bodyLength;
    else {
      offset = 0;
      this.bodyChunks = new Uint8Array(this.bodyLength);
    }
    this.bodyChunks.set(reader.readBinary(readableLength), offset);
    this.bodyLength -= readableLength;
  }
  private bodyChunks?: Uint8Array;
}
