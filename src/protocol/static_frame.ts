import { FrontendMessageCode } from "./const.ts";
import { encodeInt32BE } from "@/_utils/number.ts";

function createEmptyMessage(view: Uint8Array, offset: number, code: FrontendMessageCode): void {
  view[offset] = code;
  encodeInt32BE(view, offset + 1, 4);
}

function createStaticMessage() {
  const FRAME_CREATOR = {
    FLUSH: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(data, offset, FrontendMessageCode.Flush);
      },
    },
    SYNC: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(data, offset, FrontendMessageCode.Sync);
      },
    },
    COPY_DONE: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(data, offset, FrontendMessageCode.CopyDone);
      },
    },
    TERMINATE: {
      byteLength: 5,
      create(data: Uint8Array, offset: number) {
        createEmptyMessage(data, offset, FrontendMessageCode.Terminate);
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
