import { expect, test } from "vitest";
import { getJsDataEncoder, JS_DATA_ENCODER_V1, PgOid } from "@asla/pg";

function encode(value: unknown, offset = 2) {
  const encoder = getJsDataEncoder(JS_DATA_ENCODER_V1, value);
  const oid = typeof encoder.oid === "function" ? encoder.oid(value) : encoder.oid;
  const byteLength = "byteLength" in encoder ? encoder.byteLength : encoder.calculateByteLength(value);
  const buffer = new Uint8Array(offset + byteLength + 2).fill(0xaa);

  expect(encoder.encodeInto(buffer, offset, value)).toBe(byteLength);
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

test("字符串目标缓冲区不足时拒绝截断", () => {
  const encoder = getJsDataEncoder(JS_DATA_ENCODER_V1, "中文");
  expect(() => encoder.encodeInto(new Uint8Array(5), 0, "中文")).toThrow(RangeError);
});
