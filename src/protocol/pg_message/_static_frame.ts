import { FRONTEND_MSG_CODE } from "./const.ts";

function createEmptyMessage(view: DataView, offset: number, code: FRONTEND_MSG_CODE): void {
  view.setUint8(offset, code);
  view.setInt32(offset + 1, 4);
}

function createStaticMessage() {
  const FRAME_CREATOR = {
    FLUSH: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(new DataView(data.buffer), offset, FRONTEND_MSG_CODE.Flush);
      },
    },
    SYNC: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(new DataView(data.buffer), offset, FRONTEND_MSG_CODE.Sync);
      },
    },
    COPY_DONE: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(new DataView(data.buffer), offset, FRONTEND_MSG_CODE.CopyDone);
      },
    },
    TERMINATE: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(new DataView(data.buffer), offset, FRONTEND_MSG_CODE.Terminate);
      },
    },
  } satisfies Record<string, { byteLength: number; create(data: Uint8Array, offset: number): void }>;

  const FRAME_LENGTH = Object.values(FRAME_CREATOR).reduce((sum, info) => sum + info.byteLength, 0);
  const FRAME = new Uint8Array(FRAME_LENGTH);

  const data: Record<string, Uint8Array> = {};
  let offset = 0;
  for (const [key, info] of Object.entries(FRAME_CREATOR)) {
    info.create(FRAME, offset);
    offset += info.byteLength;
    data[key] = FRAME.subarray(offset - info.byteLength, offset);
  }

  return data as { [key in keyof typeof FRAME_CREATOR]: Uint8Array };
}

export const FRAME = createStaticMessage();
