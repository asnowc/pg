import { CSTRING_TERMINATOR, DescribeTarget, FrontendMessageCode } from "./const.ts";

function createEmptyMessage(buffer: Uint8Array, offset: number, view: DataView, code: FrontendMessageCode): number {
  buffer[offset++] = code;
  view.setInt32(offset, 4), offset += 4;
  return offset;
}

function createStaticMessage() {
  const FRAME_CREATOR = {
    FLUSH: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        createEmptyMessage(data, offset, view, FrontendMessageCode.Flush);
      },
    },
    SYNC: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        createEmptyMessage(data, offset, view, FrontendMessageCode.Sync);
      },
    },
    COPY_DONE: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        createEmptyMessage(data, offset, view, FrontendMessageCode.CopyDone);
      },
    },
    TERMINATE: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        createEmptyMessage(data, offset, view, FrontendMessageCode.Terminate);
      },
    },
    ANONYMOUS_DESCRIBE_PORTAL: {
      byteLength: 7,
      create(data: Uint8Array, view: DataView, offset: number) {
        offset = createEmptyMessage(data, offset, view, FrontendMessageCode.Describe);
        data[offset++] = DescribeTarget.Portal;
        data[offset++] = CSTRING_TERMINATOR;
      },
    },
    ANONYMOUS_DESCRIBE_STATEMENT: {
      byteLength: 7,
      create(data: Uint8Array, view: DataView, offset: number) {
        offset = createEmptyMessage(data, offset, view, FrontendMessageCode.Describe);
        data[offset++] = DescribeTarget.Statement;
        data[offset++] = CSTRING_TERMINATOR;
      },
    },
  } satisfies Record<string, { byteLength: number; create(data: Uint8Array, view: DataView, offset: number): void }>;

  const FRAME_LENGTH = Object.values(FRAME_CREATOR).reduce((sum, info) => sum + info.byteLength, 0);
  const FRAME = new Uint8Array(FRAME_LENGTH);

  const data: Record<string, Uint8Array> = {};
  let offset = 0;
  for (const [key, info] of Object.entries(FRAME_CREATOR)) {
    info.create(FRAME, new DataView(FRAME.buffer, FRAME.byteOffset, FRAME.byteLength), offset);
    offset += info.byteLength;
    data[key] = FRAME.subarray(offset - info.byteLength, offset);
  }

  return data as { readonly [key in keyof typeof FRAME_CREATOR]: Uint8Array };
}

export const FRAME = createStaticMessage();
