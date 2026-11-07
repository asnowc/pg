import { expect, test } from "vitest";
import { getJsDataEncoder, JS_DATA_ENCODER_V1 } from "@/codec/js_data_encoder.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";
import type { FieldInfo } from "@/interface/Query/QueryReader.ts";
import { PgOid } from "@/util/pg_oid.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
const encoderV1 = JS_DATA_ENCODER_V1;

const context: FieldInfo = { typeOID: 0, typeSize: -1, typeModifier: -1, index: 0, name: "" };

function getDecoder(oid: PgOid) {
  const decoder = PG_DATA_DECODER_V1.get(oid)!;
  return typeof decoder === "function" ? decoder({ ...context, typeOID: oid }) : decoder;
}

function decodeBinary(oid: PgOid, value: Uint8Array): unknown {
  const reader = new BufferReader(value, value.byteLength);
  const result = getDecoder(oid).decodeBinary(reader, value.byteLength);
  expect(reader.readableLength).toBe(0);
  return result;
}

function encode(encoder: JsDataEncoder<unknown>, value: unknown): Uint8Array {
  const byteLength = "byteLength" in encoder ? encoder.byteLength : encoder.startEncode(value).byteLength;
  const output = new Uint8Array(byteLength);
  const writer = {
    buffer: output,
    view: new DataView(output.buffer),
    writeOffset: 0,
    get writableLength() {
      return output.byteLength - this.writeOffset;
    },
  };
  if ("byteLength" in encoder) {
    encoder.encodeInto(writer, value);
  } else {
    const streamEncoder = encoder.startEncode(value);
    expect(streamEncoder.encodeInto(writer)).toBe(false);
  }
  expect(writer.writeOffset).toBe(byteLength);
  return output;
}

test("常用文本类型使用 PgOid 解码", () => {
  for (const oid of [PgOid.DATE, PgOid.TIMESTAMP, PgOid.TIMESTAMPTZ]) {
    expect(getDecoder(oid).decodeText("infinity")).toBe(Infinity);
    expect(getDecoder(oid).decodeText("-infinity")).toBe(-Infinity);
  }
  expect(getDecoder(PgOid.INT8).decodeText("9223372036854775807")).toBe(9223372036854775807n);
  expect(getDecoder(PgOid.NUMERIC).decodeText("1234567890.123400")).toBe("1234567890.123400");
  expect(getDecoder(PgOid.BYTEA).decodeText("\\x00ff80")).toEqual(Uint8Array.of(0, 255, 128));
  expect(getDecoder(PgOid.UUID).decodeText("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")).toBe(
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  );
});

test("常用二进制类型按 PostgreSQL 格式解码", () => {
  for (const oid of [PgOid.DATE, PgOid.TIMESTAMP, PgOid.TIMESTAMPTZ]) {
    const positive = Uint8Array.fromHex(oid === PgOid.DATE ? "7fffffff" : "7fffffffffffffff");
    const negative = Uint8Array.fromHex(oid === PgOid.DATE ? "80000000" : "8000000000000000");
    expect(decodeBinary(oid, positive)).toBe(Infinity);
    expect(decodeBinary(oid, negative)).toBe(-Infinity);
  }
  expect(decodeBinary(PgOid.TEXT, new TextEncoder().encode("中文"))).toBe("中文");
  expect(decodeBinary(
    PgOid.UUID,
    Uint8Array.fromHex("a0eebc999c0b4ef8bb6d6bb9bd380a11"),
  )).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  expect(decodeBinary(PgOid.BIT, Uint8Array.of(0, 0, 0, 5, 0xa8))).toBe("10101");

  const numeric = Uint8Array.of(0, 3, 0, 0, 0, 0, 0, 8, 0, 12, 0x0d, 0x7a, 0x04, 0xd2);
  expect(decodeBinary(PgOid.NUMERIC, numeric)).toBe("12.34501234");

  const time = new Uint8Array(8);
  new DataView(time.buffer).setBigInt64(0, 11_045_678_900n);
  expect(decodeBinary(PgOid.TIME, time)).toEqual(
    Temporal.PlainTime.from("03:04:05.6789"),
  );
  expect(decodeBinary(PgOid.INET, Uint8Array.of(2, 24, 0, 4, 192, 168, 1, 20))).toBe(
    "192.168.1.20/24",
  );
  expect(decodeBinary(PgOid.MACADDR, Uint8Array.of(0x08, 0, 0x2b, 1, 2, 3))).toBe(
    "08:00:2b:01:02:03",
  );
});

test("列解码器支持分段读取、列状态隔离及重复解码", () => {
  const cases: [PgOid, Uint8Array, unknown][] = [
    [PgOid.CHAR, Uint8Array.of(65), "A"],
    [PgOid.BOOL, Uint8Array.of(1), true],
    [PgOid.INT2, Uint8Array.fromHex("fffe"), -2],
    [PgOid.INT4, Uint8Array.fromHex("fffffffe"), -2],
    [PgOid.INT8, Uint8Array.fromHex("fffffffffffffffe"), -2n],
    [PgOid.OID, Uint8Array.fromHex("ffffffff"), 4294967295],
    [PgOid.XID8, Uint8Array.fromHex("ffffffffffffffff"), 18446744073709551615n],
    [PgOid.FLOAT4, Uint8Array.fromHex("3fc00000"), 1.5],
    [PgOid.FLOAT8, Uint8Array.fromHex("3ff8000000000000"), 1.5],
    [PgOid.NUMERIC, Uint8Array.fromHex("0001000000000000000c"), "12"],
    [PgOid.NUMERIC, Uint8Array.fromHex("0006000000000014000c0d7a04d2000000000001"), "12.34501234000000000001"],
    [PgOid.DATE, Uint8Array.fromHex("00000001"), Temporal.PlainDate.from("2000-01-02")],
    [PgOid.DATE, Uint8Array.fromHex("7fffffff"), Infinity],
    [PgOid.DATE, Uint8Array.fromHex("80000000"), -Infinity],
    [PgOid.TIMESTAMP, new Uint8Array(8), Temporal.PlainDateTime.from("2000-01-01T00:00:00")],
    [PgOid.TIMESTAMP, Uint8Array.fromHex("7fffffffffffffff"), Infinity],
    [PgOid.TIMESTAMP, Uint8Array.fromHex("8000000000000000"), -Infinity],
    [PgOid.TIMESTAMPTZ, new Uint8Array(8), Temporal.Instant.from("2000-01-01T00:00:00Z")],
    [PgOid.TIMESTAMPTZ, Uint8Array.fromHex("7fffffffffffffff"), Infinity],
    [PgOid.TIMESTAMPTZ, Uint8Array.fromHex("8000000000000000"), -Infinity],
    [PgOid.TIME, new Uint8Array(8), Temporal.PlainTime.from("00:00:00")],
    [PgOid.TIMETZ, new Uint8Array(12), "00:00:00+00:00"],
    [PgOid.TEXT, new TextEncoder().encode("中文😀"), "中文😀"],
    [PgOid.BYTEA, Uint8Array.of(0, 128, 255), Uint8Array.of(0, 128, 255)],
    [PgOid.UUID, new Uint8Array(16), "00000000-0000-0000-0000-000000000000"],
    [PgOid.BIT, Uint8Array.of(0, 0, 0, 5, 0xa8), "10101"],
    [PgOid.INET, Uint8Array.of(2, 24, 0, 4, 192, 168, 1, 20), "192.168.1.20/24"],
    [PgOid.INET, Uint8Array.fromHex("0380001020010db8000000000000000000000001"), "2001:db8::1"],
    [PgOid.MACADDR, Uint8Array.of(0, 1, 2, 3, 4, 5), "00:01:02:03:04:05"],
    [PgOid.JSON, new TextEncoder().encode('{"a":1}'), { a: 1 }],
    [PgOid.JSONB, Uint8Array.of(1, ...new TextEncoder().encode('{"a":1}')), { a: 1 }],
    [PgOid.JSONB, Uint8Array.of(1, ...new TextEncoder().encode("null")), null],
    [PgOid.TEXT, new TextEncoder().encode("中文😀".repeat(20)), "中文😀".repeat(20)],
    [PgOid.BYTEA, new Uint8Array(40).fill(128), new Uint8Array(40).fill(128)],
    [PgOid.JSON, new TextEncoder().encode('{"a":"中文😀"}'), { a: "中文😀" }],
    [PgOid.VOID, new Uint8Array(0), undefined],
    [PgOid.BYTEA, new Uint8Array(0), new Uint8Array(0)],
    [PgOid.TEXT, new Uint8Array(0), ""],
  ];
  for (const [oid, value, expected] of cases) {
    const decoder = getDecoder(oid);
    const otherColumn = getDecoder(oid);
    if (value.byteLength === 0) {
      expect(decoder.decodeBinary(new BufferReader(value), 0)).toEqual(expected);
      continue;
    }
    const bufferLength = typeof PG_DATA_DECODER_V1.get(oid) === "object" ? Math.max(16, value.byteLength) : 16;
    const reader = new BufferReader(new Uint8Array(bufferLength + 2).subarray(1, bufferLength + 1));
    let consumed = 0;
    for (let offset = 0; offset < value.byteLength; offset++) {
      expect(reader.pushReaderBufferData(value.subarray(offset, offset + 1))).toBe(1);
      const start = reader.readableStart;
      const result = decoder.decodeBinary(reader, value.byteLength - consumed);
      consumed += reader.readableStart - start;
      if (offset + 1 < value.byteLength) {
        expect(result).toBeUndefined();
        expect(otherColumn.decodeBinary(new BufferReader(value, value.byteLength), value.byteLength)).toEqual(expected);
      } else {
        expect(result).toEqual(expected);
        expect(consumed).toBe(value.byteLength);
        expect(reader.readableLength).toBe(0);
      }
      reader.gc();
    }
    const nextRow = new BufferReader(value, value.byteLength);
    expect(decoder.decodeBinary(nextRow, value.byteLength)).toEqual(expected);
    expect(nextRow.readableLength).toBe(0);
  }
});

test("无状态列解码器直接使用对象并在数据不足时保持读取位置", () => {
  const cases: [PgOid, number][] = [
    [PgOid.CHAR, 1],
    [PgOid.BOOL, 1],
    [PgOid.INT2, 2],
    [PgOid.INT4, 4],
    [PgOid.INT8, 8],
    [PgOid.OID, 4],
    [PgOid.XID8, 8],
    [PgOid.FLOAT4, 4],
    [PgOid.FLOAT8, 8],
    [PgOid.DATE, 4],
    [PgOid.TIMESTAMP, 8],
    [PgOid.TIMESTAMPTZ, 8],
    [PgOid.TIME, 8],
    [PgOid.TIMETZ, 12],
    [PgOid.UUID, 16],
    [PgOid.INET, 8],
    [PgOid.INET, 20],
    [PgOid.BIT, 5],
    [PgOid.VARBIT, 5],
    [PgOid.MACADDR, 6],
    [PgOid.MACADDR8, 8],
    [PgOid.VOID, 0],
  ];
  for (const [oid, length] of cases) {
    expect(typeof PG_DATA_DECODER_V1.get(oid)).toBe("object");
    if (length === 0) continue;
    const reader = new BufferReader(new Uint8Array(length), length - 1);
    expect(getDecoder(oid).decodeBinary(reader, length)).toBeUndefined();
    expect(reader.readableStart).toBe(0);
  }
});

test("动态长度列解码器边读边解码且不越过列边界", () => {
  const cases: [PgOid, Uint8Array, number, unknown][] = [
    [PgOid.NUMERIC, Uint8Array.fromHex("0002000000000004000c0d7a"), 10, "12.3450"],
    [PgOid.TEXT, new TextEncoder().encode("中文😀"), 1, "中文😀"],
    [PgOid.BYTEA, Uint8Array.of(0, 128, 255), 1, Uint8Array.of(0, 128, 255)],
    [PgOid.JSON, new TextEncoder().encode('{"a":"中文"}'), 1, { a: "中文" }],
    [PgOid.JSONB, Uint8Array.of(1, ...new TextEncoder().encode('{"a":"中文"}')), 2, { a: "中文" }],
  ];
  for (const [oid, value, split, expected] of cases) {
    expect(typeof PG_DATA_DECODER_V1.get(oid)).toBe("function");
    const decoder = getDecoder(oid);
    const first = new BufferReader(value.subarray(0, split), split);
    expect(decoder.decodeBinary(first, value.byteLength)).toBeUndefined();
    expect(first.readableStart).toBe(split);
    const remaining = value.byteLength - split;
    const tail = new Uint8Array(remaining + 1);
    tail.set(value.subarray(split));
    tail[remaining] = 0xff;
    const reader = new BufferReader(tail, tail.byteLength);
    const result = decoder.decodeBinary(reader, remaining);
    expect(result).toEqual(expected);
    expect(reader.readableLength).toBe(1);
    expect(reader.view.getUint8(reader.readableStart)).toBe(0xff);
    reader.readableStart++;
    tail.fill(0);
    expect(result).toEqual(expected);
  }
});

test("Temporal.PlainDate 参数编码为 PostgreSQL epoch 天数", () => {
  const value = Temporal.PlainDate.from("2000-01-02");
  const dataEncoder = getJsDataEncoder(encoderV1, value);
  expect(dataEncoder.oid).toBe(PgOid.DATE);
  const output = encode(dataEncoder, value);
  expect(new DataView(output.buffer).getInt32(0)).toBe(1);
});

test("Temporal.PlainTime 参数编码为午夜后的微秒数", () => {
  const value = Temporal.PlainTime.from("03:04:05.6789");
  const dataEncoder = getJsDataEncoder(encoderV1, value);
  expect(dataEncoder.oid).toBe(PgOid.TIME);
  const output = encode(dataEncoder, value);
  expect(new DataView(output.buffer).getBigInt64(0)).toBe(11_045_678_900n);
});

test("Temporal.PlainDateTime 参数编码为 PostgreSQL epoch 微秒", () => {
  const value = Temporal.PlainDateTime.from("2000-01-02T00:00:00");
  const dataEncoder = getJsDataEncoder(encoderV1, value);
  expect(dataEncoder.oid).toBe(PgOid.TIMESTAMP);
  const output = encode(dataEncoder, value);
  expect(new DataView(output.buffer).getBigInt64(0)).toBe(86_400_000_000n);
});

test("Temporal.Instant 参数编码为 PostgreSQL epoch 微秒", () => {
  const value = Temporal.Instant.from("2000-01-02T00:00:00Z");
  const dataEncoder = getJsDataEncoder(encoderV1, value);
  expect(dataEncoder.oid).toBe(PgOid.TIMESTAMPTZ);
  const output = encode(dataEncoder, value);
  expect(new DataView(output.buffer).getBigInt64(0)).toBe(86_400_000_000n);
});
