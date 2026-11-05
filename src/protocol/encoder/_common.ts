import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { FrontendMessageCode } from "../const.ts";

export function encodeFrameHeaderInto(writer: BufferWriter, code: FrontendMessageCode, bodyLength: number) {
  writer.buffer[writer.writeOffset++] = code;
  writer.view.setInt32(writer.writeOffset, bodyLength + 4);
  writer.writeOffset += 4;
}
export interface DynamicLengthBlockEncoder {
  readonly messageCode: number;
  readonly bodyLength: number;
  /**
   * 返回 false, 编码结束，返回 true 表示缓冲区需要更多空间继续编码。
   * 应在缓冲区有足够空间时继续调用 encodeInto 继续编码
   */
  encodeInto(writer: BufferWriter): boolean;
}
export interface BufferEncoder {
  encodeInto(writer: BufferWriter): boolean;
}
export interface FixedEncoder {
  readonly requiredByteLength: number;
  encodeInto(writer: BufferWriter): void;
}
const textEncoder = new TextEncoder();

export class UTF16BufferEncoder implements BufferEncoder {
  /**
   * 编码字符串为 UTF-16 前要求缓冲区至少有 UTF16_ENCODE_FREE_BUFFER_SIZE 个可写字节。
   * 该值用于确保在编码过程中缓冲区有足够的空间，避免频繁的缓冲区扩展。
   */
  static readonly UTF16_ENCODE_FREE_BUFFER_SIZE = 10;
  constructor(private value: string) {}
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    if (writer.writableLength < UTF16BufferEncoder.UTF16_ENCODE_FREE_BUFFER_SIZE) return true;
    const { read, written } = textEncoder.encodeInto(
      this.value.substring(this.offset),
      writer.buffer.subarray(writer.writeOffset),
    );
    writer.writeOffset += written;
    this.offset += read;
    return this.offset < this.value.length;
  }
  reset(value: string) {
    this.value = value;
    this.offset = 0;
  }
}

export class CStringEncoder implements BufferEncoder {
  constructor(private value: string) {}
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean {
    if (this.offset < this.value.length) {
      if (writer.writableLength < UTF16BufferEncoder.UTF16_ENCODE_FREE_BUFFER_SIZE) return true;
      const { read, written } = textEncoder.encodeInto(
        this.value.substring(this.offset),
        writer.buffer.subarray(writer.writeOffset),
      );
      writer.writeOffset += written;
      this.offset += read;
      if (this.offset < this.value.length) return true;
    }

    if (writer.writableLength < 1) return true;
    writer.buffer[writer.writeOffset++] = 0;
    return false;
  }
  reset(value: string) {
    this.value = value;
    this.offset = 0;
  }
}
export class MessageEncoder implements BufferEncoder {
  constructor(private readonly encoder: DynamicLengthBlockEncoder) {
  }
  private headWritten: boolean = false;
  encodeInto(writer: BufferWriter): boolean {
    if (!this.headWritten) {
      if (writer.writableLength < 5) return true;
      writer.buffer[writer.writeOffset++] = this.encoder.messageCode;
      writer.view.setInt32(writer.writeOffset, this.encoder.bodyLength + 4), writer.writeOffset += 4;
      this.headWritten = true;
    }
    return this.encoder.encodeInto(writer);
  }
}
