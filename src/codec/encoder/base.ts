import { calcCStringByteLength } from "@/_utils/string.ts";
import type { JsDataEncoder, WriterBuffer } from "@/interface/js_data_encoder.ts";
import { PgOid } from "@/util/pg_oid.ts";

const textEncoder = new TextEncoder();

export const stringEncoder: JsDataEncoder<string> = {
  oid: PgOid.TEXT,
  encodeToText: String,
  startEncode(value) {
    const byteLength = calcCStringByteLength(value);
    return {
      byteLength,
      encodeInto(writer) {
        const { read, written } = textEncoder.encodeInto(
          value,
          writer.buffer.subarray(writer.writeOffset, writer.writeOffset + writer.writableLength),
        );
        writer.writeOffset += written;
        value = value.substring(read);
        return value.length > 0;
      },
    };
  },
};
export const int4Encoder: JsDataEncoder<number> = {
  oid: PgOid.INT4,
  encodeToText: String,
  byteLength: 4,
  encodeInto(writer, value) {
    writer.view.setInt32(writer.writeOffset, value), writer.writeOffset += 4;
  },
};
export const f64Encoder: JsDataEncoder<number> = {
  oid: PgOid.FLOAT8,
  encodeToText: String,
  byteLength: 8,
  encodeInto(writer, value) {
    writer.view.setFloat64(writer.writeOffset, value), writer.writeOffset += 8;
  },
};
export const booleanEncoder: JsDataEncoder<boolean> = {
  oid: PgOid.BOOL,
  encodeToText: (value) => value ? "true" : "false",
  byteLength: 1,
  encodeInto(writer, value) {
    writer.buffer[writer.writeOffset++] = value ? 1 : 0;
  },
};
export const bytesEncoder: JsDataEncoder<Uint8Array> = {
  oid: PgOid.BYTEA,
  encodeToText: (value) => `\\x${value.toHex()}`,
  startEncode(value) {
    return {
      byteLength: value.byteLength,
      encodeInto(writer: WriterBuffer) {
        const byteLength = Math.min(value.byteLength, writer.writableLength);
        writer.buffer.set(value.subarray(0, byteLength), writer.writeOffset);
        writer.writeOffset += byteLength;
        value = value.subarray(byteLength);
        return value.byteLength > 0;
      },
    };
  },
};
