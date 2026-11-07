import { FrontendMessageCode } from "../const.ts";
import { BufferEncoder } from "./_common.ts";

export const TerminateFrame: BufferEncoder = {
  encodeInto(writer) {
    if (writer.writableLength < 5) return true;
    writer.buffer[writer.writeOffset++] = FrontendMessageCode.Terminate;
    writer.view.setInt32(writer.writeOffset, 4), writer.writeOffset += 4;
  },
};
