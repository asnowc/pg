import { WritableBuffer } from "@/internal/WriterBuffer.ts";
import { BufferEncoder, encodeFrameHeaderInto } from "./_common.ts";
import { FrontendMessageCode } from "../const.ts";

export class QueryMessageEncoder implements BufferEncoder {
  constructor(bodyEncoder: BufferEncoder, bodyLength: number) {
    this.encoder = bodyEncoder;
    this.bodyLength = bodyLength;
  }
  private encoder?: BufferEncoder;
  private bodyLength?: number;
  encodeInto(writer: WritableBuffer): boolean | void {
    if (this.bodyLength !== undefined) {
      if (writer.writableLength < 5) return true;
      encodeFrameHeaderInto(writer, FrontendMessageCode.Query, this.bodyLength);
      this.bodyLength = undefined;
    }
    if (this.encoder) {
      if (this.encoder.encodeInto(writer)) return true;
      this.encoder = undefined;
    }
    if (writer.writableLength < 1) return true;
    ((writer.buffer[writer.writeOffset] = 0), (writer.writeOffset += 1)); // null terminator
  }
}
