import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import { createSqlBuilder, JS_DATA_ENCODER_V1 } from "@asla/pg";
const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

test("扩展查询编码参数并解码 NULL", async ({ connect }) => {
  const query = connect.query<{ value: number; nullable: string | null }>({
    sqlTemplate: "SELECT $1::int AS value, $2::text AS nullable",
    argsFormat: 0,
    args: ["42", ""],
  });
  await expect(query.getFirstRow()).resolves.toEqual({ value: 42, nullable: "" });
});

test("reader 只能消费一次", async ({ connect }) => {
  const query = connect.query<{ value: number }>("SELECT 1::int AS value");
  await expect(query.getRows()).resolves.toEqual([{ value: 1 }]);
  await expect(query.getRows()).rejects.toThrow();
});

test("并发扩展查询按各自操作归属结果", async ({ connect }) => {
  const [slow, fast] = await Promise.all([
    connect.query<{ value: number }>("SELECT 1::int AS value FROM pg_sleep(0.05)").getFirstRow(),
    connect.query<{ value: number }>("SELECT 2::int AS value").getFirstRow(),
  ]);
  expect(slow).toEqual({ value: 1 });
  expect(fast).toEqual({ value: 2 });
});

const decoderCases: ReadonlyArray<readonly [type: string, expression: string, expected: unknown]> = [
  ["bool", "true::bool", true],
  ["bytea", "'\\x00ff80'::bytea", Uint8Array.of(0, 255, 128)],
  ["int4", "42::int4", 42],
  ["int8", "9223372036854775807::int8", 9223372036854775807n],
  ["numeric", "1234567890.123400::numeric", "1234567890.123400"],
  ["jsonb", `'{"ok":true}'::jsonb`, { ok: true }],
  ["uuid", "'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::uuid", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"],
  ["bit", "B'10101'::bit(5)", "10101"],
  ["varchar", "'hello'::varchar", "hello"],
];

for (const [type, expression, expected] of decoderCases) {
  test(`解码 PostgreSQL ${type}`, async ({ connect }) => {
    const row = await connect.query<{ value: unknown }>(`SELECT ${expression} AS value`).getFirstRow();
    expect(row?.value).toEqual(expected);
  });
}

const temporalDecoderCases: ReadonlyArray<readonly [type: string, expression: string, expected: object]> = [
  ["date", "'2024-01-02'::date", Temporal.PlainDate.from("2024-01-02")],
  ["time", "'03:04:05.6789'::time", Temporal.PlainTime.from("03:04:05.6789")],
  ["timestamp", "'2024-01-02 03:04:05.678'::timestamp", Temporal.PlainDateTime.from("2024-01-02T03:04:05.678")],
  ["timestamptz", "'2024-01-02 03:04:05.678+00'::timestamptz", Temporal.Instant.from("2024-01-02T03:04:05.678Z")],
];

for (const [type, expression, expected] of temporalDecoderCases) {
  test(`使用 Temporal 解码 PostgreSQL ${type}`, async ({ connect }) => {
    const row = await connect.query<{ value: object }>(`SELECT ${expression} AS value`).getFirstRow();
    expect(row?.value.constructor).toBe(expected.constructor);
    expect(String(row?.value)).toBe(String(expected));
  });
}

const temporalEncoderCases: ReadonlyArray<readonly [type: string, value: object]> = [
  ["date", Temporal.PlainDate.from("2024-01-02")],
  ["time", Temporal.PlainTime.from("03:04:05.6789")],
  ["timestamp", Temporal.PlainDateTime.from("2024-01-02T03:04:05.678")],
  ["timestamptz", Temporal.Instant.from("2024-01-02T03:04:05.678Z")],
];

for (const [type, value] of temporalEncoderCases) {
  test(`编码 Temporal ${type} 参数`, async ({ connect }) => {
    const row = await connect.query<{ value: object }>(sql`SELECT ${value} AS value`).getFirstRow();
    expect(row?.value.constructor).toBe(value.constructor);
    expect(String(row?.value)).toBe(String(value));
  });
}
