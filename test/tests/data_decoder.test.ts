import { expect, test } from "vitest";
import { JS_DATA_ENCODER_V1, PG_DATA_DECODER_V1, PgOid } from "@asla/pg";

const context = { typeId: 0, typeSize: -1, typeModifier: -1 };

test("常用文本类型使用 PgOid 解码", () => {
  expect(PG_DATA_DECODER_V1.get(PgOid.INT8)!.text("9223372036854775807", context)).toBe(9223372036854775807n);
  expect(PG_DATA_DECODER_V1.get(PgOid.NUMERIC)!.text("1234567890.123400", context)).toBe("1234567890.123400");
  expect(PG_DATA_DECODER_V1.get(PgOid.BYTEA)!.text("\\x00ff80", context)).toEqual(Uint8Array.of(0, 255, 128));
  expect(PG_DATA_DECODER_V1.get(PgOid.UUID)!.text("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", context)).toBe(
    "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
  );
});

test("常用二进制类型按 PostgreSQL 格式解码", () => {
  expect(PG_DATA_DECODER_V1.get(PgOid.TEXT)!.binary(new TextEncoder().encode("中文"), context)).toBe("中文");
  expect(PG_DATA_DECODER_V1.get(PgOid.UUID)!.binary(
    Uint8Array.fromHex("a0eebc999c0b4ef8bb6d6bb9bd380a11"),
    context,
  )).toBe("a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11");
  expect(PG_DATA_DECODER_V1.get(PgOid.BIT)!.binary(Uint8Array.of(0, 0, 0, 5, 0xa8), context)).toBe("10101");

  const numeric = Uint8Array.of(0, 3, 0, 0, 0, 0, 0, 8, 0, 12, 0x0d, 0x7a, 0x04, 0xd2);
  expect(PG_DATA_DECODER_V1.get(PgOid.NUMERIC)!.binary(numeric, context)).toBe("12.34501234");

  const time = new Uint8Array(8);
  new DataView(time.buffer).setBigInt64(0, 11_045_678_900n);
  expect(PG_DATA_DECODER_V1.get(PgOid.TIME)!.binary(time, context)).toEqual(
    Temporal.PlainTime.from("03:04:05.6789"),
  );
  expect(PG_DATA_DECODER_V1.get(PgOid.INET)!.binary(Uint8Array.of(2, 24, 0, 4, 192, 168, 1, 20), context)).toBe(
    "192.168.1.20/24",
  );
  expect(PG_DATA_DECODER_V1.get(PgOid.MACADDR)!.binary(Uint8Array.of(0x08, 0, 0x2b, 1, 2, 3), context)).toBe(
    "08:00:2b:01:02:03",
  );
});

test("Temporal.PlainDate 参数编码为 PostgreSQL epoch 天数", () => {
  const value = Temporal.PlainDate.from("2000-01-02");
  const dataEncoder = JS_DATA_ENCODER_V1.get(Temporal.PlainDate)!;
  expect(dataEncoder.getOid(value)).toBe(PgOid.DATE);
  expect(new DataView(dataEncoder.binary(value, PgOid.DATE).buffer).getInt32(0)).toBe(1);
});

test("Temporal.PlainTime 参数编码为午夜后的微秒数", () => {
  const value = Temporal.PlainTime.from("03:04:05.6789");
  const dataEncoder = JS_DATA_ENCODER_V1.get(Temporal.PlainTime)!;
  expect(dataEncoder.getOid(value)).toBe(PgOid.TIME);
  expect(new DataView(dataEncoder.binary(value, PgOid.TIME).buffer).getBigInt64(0)).toBe(11_045_678_900n);
});

test("Temporal.PlainDateTime 参数编码为 PostgreSQL epoch 微秒", () => {
  const value = Temporal.PlainDateTime.from("2000-01-02T00:00:00");
  const dataEncoder = JS_DATA_ENCODER_V1.get(Temporal.PlainDateTime)!;
  expect(dataEncoder.getOid(value)).toBe(PgOid.TIMESTAMP);
  expect(new DataView(dataEncoder.binary(value, PgOid.TIMESTAMP).buffer).getBigInt64(0)).toBe(86_400_000_000n);
});

test("Temporal.Instant 参数编码为 PostgreSQL epoch 微秒", () => {
  const value = Temporal.Instant.from("2000-01-02T00:00:00Z");
  const dataEncoder = JS_DATA_ENCODER_V1.get(Temporal.Instant)!;
  expect(dataEncoder.getOid(value)).toBe(PgOid.TIMESTAMPTZ);
  expect(new DataView(dataEncoder.binary(value, PgOid.TIMESTAMPTZ).buffer).getBigInt64(0)).toBe(86_400_000_000n);
});
