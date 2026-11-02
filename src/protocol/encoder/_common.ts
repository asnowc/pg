import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { FrontendMessageCode } from "../const.ts";

export function encodeFrameHeaderInto(writer: BufferWriter, code: FrontendMessageCode, bodyLength: number): boolean {
  if (writer.writableLength < 5) return false;
  writer.buffer[writer.writeOffset++] = code;
  writer.view.setInt32(writer.writeOffset, bodyLength + 4);
  writer.writeOffset += 4;
  return true;
}
