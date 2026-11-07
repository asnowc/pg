import { CSTRING_TERMINATOR, DescribeTarget, FrontendMessageCode } from "./const.ts";

function encodeMessageHeaderInto(
  view: DataView,
  offset: number,
  code: FrontendMessageCode,
  bodyLength: number = 0,
): number {
  view.setUint8(offset, code), offset += 1;
  view.setInt32(offset, bodyLength + 4), offset += 4;
  return offset;
}

function createStaticMessage() {
  const FRAME_CREATOR = {
    FLUSH: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        encodeMessageHeaderInto(view, offset, FrontendMessageCode.Flush);
      },
    },
    SYNC: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        encodeMessageHeaderInto(view, offset, FrontendMessageCode.Sync);
      },
    },
    COPY_DONE: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        encodeMessageHeaderInto(view, offset, FrontendMessageCode.CopyDone);
      },
    },
    TERMINATE: {
      byteLength: 5,
      create(data: Uint8Array, view: DataView, offset: number) {
        encodeMessageHeaderInto(view, offset, FrontendMessageCode.Terminate);
      },
    },
    DESCRIBE_PORTAL_ANONYMOUS: {
      byteLength: 7,
      create(data: Uint8Array, view: DataView, offset: number) {
        offset = encodeMessageHeaderInto(view, offset, FrontendMessageCode.Describe, 2);
        data[offset++] = DescribeTarget.Portal;
        data[offset++] = CSTRING_TERMINATOR;
      },
    },
    DESCRIBE_STATEMENT_ANONYMOUS: {
      byteLength: 7,
      create(data: Uint8Array, view: DataView, offset: number) {
        offset = encodeMessageHeaderInto(view, offset, FrontendMessageCode.Describe, 2);
        data[offset++] = DescribeTarget.Statement;
        data[offset++] = CSTRING_TERMINATOR;
      },
    },
    BIND_ANONYMOUS_PORTAL_NO_PARAMS: {
      byteLength: 13,
      create(data: Uint8Array, view: DataView, offset: number) {
        offset = encodeMessageHeaderInto(view, offset, FrontendMessageCode.Bind, 8);
        data[offset++] = CSTRING_TERMINATOR; // portal name
        data[offset++] = CSTRING_TERMINATOR; // statement names
        view.setInt16(offset, 0), offset += 2; // format code count
        view.setInt16(offset, 0), offset += 2; // parameter value count
        view.setInt16(offset, 0), offset += 2; // result column count
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
