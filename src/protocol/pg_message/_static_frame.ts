import { FRONTEND_MSG_CODE } from "./const.ts";

const FRAME_LENGTH = 5;
const FRAME = new Uint8Array(FRAME_LENGTH * 4);
const view = new DataView(FRAME.buffer);
let offset = 0;

function createFrame(code: FRONTEND_MSG_CODE): Uint8Array {
  FRAME[offset] = code;
  view.setInt32(offset + 1, 4);
  const frame = FRAME.subarray(offset, offset + FRAME_LENGTH);
  offset += FRAME_LENGTH;
  return frame;
}

export const FLUSH = createFrame(FRONTEND_MSG_CODE.flush);
export const SYNC = createFrame(FRONTEND_MSG_CODE.sync);
export const COPY_DONE = createFrame(FRONTEND_MSG_CODE.copyDone);
export const TERMINATE = createFrame(FRONTEND_MSG_CODE.terminate);
