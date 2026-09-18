import { encodeInt32BE } from "@/_utils/number.ts";
import { calcUTF16ByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";
import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";
import { PgOid } from "@/util/pg_oid.ts";

export const stringEncoder: JsDataEncoder<string> = {
  oid: PgOid.TEXT,
  encodeToText: String,
  calculateByteLength: calcUTF16ByteLength,
  encodeInto: (buffer, offset, value) => encodeUTF16StringInto(value, buffer.subarray(offset)),
};
export const numberEncoder: JsDataEncoder<number> = {
  oid: getNumberOid,
  encodeToText: String,
  calculateByteLength: (value) => getNumberOid(value) === PgOid.INT4 ? 4 : 8,
  encodeInto(buffer, offset, value) {
    if (getNumberOid(value) === PgOid.INT4) return encodeInt32BE(buffer, offset, value);
    new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength).setFloat64(offset, value);
    return 8;
  },
};
export const booleanEncoder: JsDataEncoder<boolean> = {
  oid: PgOid.BOOL,
  encodeToText: (value) => value ? "true" : "false",
  byteLength: 1,
  encodeInto(buffer, offset, value) {
    buffer[offset] = value ? 1 : 0;
    return 1;
  },
};
export const bytesEncoder: JsDataEncoder<Uint8Array> = {
  oid: PgOid.BYTEA,
  encodeToText: (value) => `\\x${toHex(value)}`,
  calculateByteLength: (value) => value.byteLength,
  encodeInto(buffer, offset, value) {
    buffer.set(value, offset);
    return value.byteLength;
  },
};

function getNumberOid(value: number): number {
  return Number.isInteger(value) ? PgOid.INT4 : PgOid.FLOAT8;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
