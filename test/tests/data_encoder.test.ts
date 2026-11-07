import { expect, test } from "vitest";
import { getJsDataEncoder, JS_DATA_ENCODER_V1, PgOid } from "@asla/pg";
import type { WriterBuffer } from "@/interface/js_data_encoder.ts";

function createWriter(buffer: Uint8Array, offset = 0, end = buffer.byteLength): WriterBuffer {
  return {
    buffer,
    view: new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength),
    writeOffset: offset,
    get writableLength() {
      return end - this.writeOffset;
    },
  };
}

function encode(value: unknown, offset = 2) {
  const encoder = getJsDataEncoder(JS_DATA_ENCODER_V1, value);
  const oid = encoder.oid;
  const streamEncoder = "byteLength" in encoder ? undefined : encoder.startEncode(value);
  const byteLength = "byteLength" in encoder ? encoder.byteLength : streamEncoder!.byteLength;
  const buffer = new Uint8Array(offset + byteLength + 2).fill(0xaa);

  const writer = createWriter(buffer, offset, offset + byteLength);
  if ("byteLength" in encoder) {
    encoder.encodeInto(writer, value);
  } else {
    expect(streamEncoder!.encodeInto(writer)).toBe(false);
  }
  expect(writer.writeOffset).toBe(offset + byteLength);
  expect(buffer.subarray(0, offset)).toEqual(new Uint8Array(offset).fill(0xaa));
  expect(buffer.subarray(offset + byteLength)).toEqual(new Uint8Array(2).fill(0xaa));
  return { data: buffer.subarray(offset, offset + byteLength), oid };
}

test("字符串按 UTF-8 字节长度原地编码", () => {
  const { data, oid } = encode("中文");
  expect(oid).toBe(PgOid.TEXT);
  expect(data).toEqual(Uint8Array.fromHex("e4b8ade69687"));
});

test("整数和小数选择对应 OID 与二进制宽度", () => {
  const integer = encode(42);
  expect(integer.oid).toBe(PgOid.INT4);
  expect(integer.data.byteLength).toBe(4);
  expect(new DataView(integer.data.buffer, integer.data.byteOffset).getInt32(0)).toBe(42);

  const float = encode(1.5);
  expect(float.oid).toBe(PgOid.FLOAT8);
  expect(float.data.byteLength).toBe(8);
  expect(new DataView(float.data.buffer, float.data.byteOffset).getFloat64(0)).toBe(1.5);
});

test("布尔值和字节数组写入指定偏移", () => {
  expect(encode(false)).toEqual({ data: Uint8Array.of(0), oid: PgOid.BOOL });
  expect(encode(Uint8Array.of(0, 255, 128))).toEqual({
    data: Uint8Array.of(0, 255, 128),
    oid: PgOid.BYTEA,
  });
});

test("字符串目标缓冲区不足时保留完整字符并继续编码", () => {
  const encoder = getJsDataEncoder(JS_DATA_ENCODER_V1, "中文");
  if ("byteLength" in encoder) throw new Error("Expected a variable-length string encoder");
  const streamEncoder = encoder.startEncode("中文");
  expect(streamEncoder.byteLength).toBe(6);
  const first = createWriter(new Uint8Array(7).fill(0xaa), 1, 6);
  expect(streamEncoder.encodeInto(first)).toBe(true);
  expect(first.writeOffset).toBe(4);
  expect(first.buffer.subarray(1, 4)).toEqual(Uint8Array.fromHex("e4b8ad"));
  expect(first.buffer.subarray(4)).toEqual(new Uint8Array(3).fill(0xaa));
  expect(first.buffer[0]).toBe(0xaa);
  const second = createWriter(new Uint8Array(3));
  expect(streamEncoder.encodeInto(second)).toBe(false);
  expect(second.writeOffset).toBe(3);
  expect(second.buffer).toEqual(Uint8Array.fromHex("e69687"));
});
