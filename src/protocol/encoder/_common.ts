import { WritableBuffer } from "@/internal/WriterBuffer.ts";
import { BufferEncoder } from "@/internal/BufferWriterQueue.ts";
import { FrontendMessageCode } from "../const.ts";

export function encodeFrameHeaderInto(writer: WritableBuffer, code: FrontendMessageCode, bodyLength: number) {
  writer.view.setUint8(writer.writeOffset++, code);
  (writer.view.setInt32(writer.writeOffset, bodyLength + 4), (writer.writeOffset += 4));
}
export type { BufferEncoder };

const textEncoder = new TextEncoder();

export class UTF16BufferEncoder implements BufferEncoder {
  /**
   * 编码字符串为 UTF-16 前要求缓冲区至少有 UTF16_ENCODE_FREE_BUFFER_SIZE 个可写字节。
   * 该值用于确保在编码过程中缓冲区有足够的空间，避免频繁的缓冲区扩展。
   */
  static readonly UTF16_ENCODE_FREE_BUFFER_SIZE = 10;
  constructor(private value: string) {}
  private offset: number = 0;
  encodeInto(writer: WritableBuffer): boolean | void {
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
  encodeInto(writer: WritableBuffer): boolean | void {
    const rest = writer.setData(this.value);
    if (rest) {
      this.value = rest;
      return true;
    }
  }
}
export class CStringEncoder implements BufferEncoder {
  constructor(private value: string) {}
  private offset: number = 0;
  encodeInto(writer: WritableBuffer): boolean | void {
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
  encodeInto(writer: WritableBuffer): boolean {
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
  (writer: WritableBuffer): StageEncode | boolean;
}
