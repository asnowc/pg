import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { FrontendMessageCode } from "../const.ts";

export function encodeFrameHeaderInto(writer: BufferWriter, code: FrontendMessageCode, bodyLength: number) {
  writer.buffer[writer.writeOffset++] = code;
  writer.view.setInt32(writer.writeOffset, bodyLength + 4);
  writer.writeOffset += 4;
}
export interface DynamicLengthBlockEncoder {
  /**
   * 返回 true, 编码结束，返回 false 表示缓冲区需要更多空间继续编码。
   * 应在缓冲区有足够空间时继续调用 encodeInto 继续编码
   */
  encodeInto(writer: BufferWriter): boolean;
}
