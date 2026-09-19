import { PgOid } from "@/util/pg_oid.ts";
import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";

const encoder = new TextEncoder();
export const stringEncoder: JsDataEncoder<string> = {
  getOid: () => PgOid.TEXT,
  text: String,
  encode: (value) => encoder.encode(value),
};
export const numberEncoder: JsDataEncoder<number> = {
  getOid: (value) => Number.isInteger(value) ? PgOid.INT4 : PgOid.FLOAT8,
  text: String,
  encode(value, oid) {
    const output = new Uint8Array(oid === PgOid.INT4 ? 4 : 8);
    const view = new DataView(output.buffer);
    oid === PgOid.INT4 ? view.setInt32(0, value) : view.setFloat64(0, value);
    return output;
  },
};
export const booleanEncoder: JsDataEncoder<boolean> = {
  getOid: () => PgOid.BOOL,
  text: (value) => value ? "true" : "false",
  encode: (value) => Uint8Array.of(value ? 1 : 0),
};
export const bytesEncoder: JsDataEncoder<Uint8Array> = {
  getOid: () => PgOid.BYTEA,
  text: (value) => `\\x${toHex(value)}`,
  encode: (value) => value,
};

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
