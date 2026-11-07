import { BufferWriter } from "@/_utils/BufferWriter.ts";
import { FrontendMessageCode } from "../const.ts";

export function encodeFrameHeaderInto(
  writer: BufferWriter,
  code: FrontendMessageCode,
  bodyLength: number,
) {
  writer.view.setUint8(writer.writeOffset++, code);
  writer.view.setInt32(writer.writeOffset, bodyLength + 4), writer.writeOffset += 4;
}

export interface BufferEncoder {
  /**
   * 返回 false, 编码结束，返回 true 表示缓冲区需要更多空间继续编码。
   * 应在缓冲区有足够空间时继续调用 encodeInto 继续编码
   */
  encodeInto(writer: BufferWriter): boolean | void;
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
  encodeInto(writer: BufferWriter): boolean | void {
    if (this.offset >= this.value.length) return false;
    if (writer.writableLength === 0) return true;
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
export class Uint8ArrayEncoder implements BufferEncoder {
  constructor(private value: Uint8Array) {}
  encodeInto(writer: BufferWriter): boolean | void {
    const rest = writer.setDataToThreshold(this.value);
    if (rest) {
      this.value = rest;
      return true;
    }
  }
}
export class CStringEncoder implements BufferEncoder {
  constructor(private value: string) {}
  private offset: number = 0;
  encodeInto(writer: BufferWriter): boolean | void {
    if (this.offset < this.value.length) {
      if (writer.writableLength === 0) return true;
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
  }
  reset(value: string) {
    this.value = value;
    this.offset = 0;
  }
}

export abstract class StageBufferEncoder implements BufferEncoder {
  encodeInto(writer: BufferWriter): boolean {
    let nextStage: StageEncode | boolean;
    do {
      nextStage = this.encodeStage(writer);
      if (nextStage === true) return true;
      if (nextStage == false) return false;
      this.encodeStage = nextStage;
    } while (true);
  }
  protected abstract encodeStage: StageEncode;
}
export interface StageEncode {
  (writer: BufferWriter): StageEncode | boolean;
}
