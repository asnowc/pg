import { encodeInt32BE, encodeInt64BE } from "@/_utils/number.ts";
import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";
import { PgOid } from "@/util/pg_oid.ts";

const POSTGRES_EPOCH_DATE = Temporal.PlainDate.from("2000-01-01");
const POSTGRES_EPOCH_INSTANT = Temporal.Instant.from("2000-01-01T00:00:00Z");

export const plainDateEncoder: JsDataEncoder<Temporal.PlainDate> = {
  oid: PgOid.DATE,
  encodeToText: (value) => value.toString(),
  byteLength: 4,
  encodeInto: (buffer, offset, value) =>
    encodeInt32BE(buffer, offset, POSTGRES_EPOCH_DATE.until(value, { largestUnit: "day" }).days),
};
export const plainTimeEncoder: JsDataEncoder<Temporal.PlainTime> = {
  oid: PgOid.TIME,
  encodeToText: (value) => value.toString(),
  byteLength: 8,
  encodeInto: (buffer, offset, value) => encodeInt64BE(buffer, offset, plainTimeToMicroseconds(value)),
};
export const plainDateTimeEncoder: JsDataEncoder<Temporal.PlainDateTime> = {
  oid: PgOid.TIMESTAMP,
  encodeToText: (value) => value.toString(),
  byteLength: 8,
  encodeInto: (buffer, offset, value) => encodeTimestampInto(buffer, offset, value.toZonedDateTime("UTC").toInstant()),
};
export const instantEncoder: JsDataEncoder<Temporal.Instant> = {
  oid: PgOid.TIMESTAMPTZ,
  encodeToText: (value) => value.toString(),
  byteLength: 8,
  encodeInto: encodeTimestampInto,
};
export const dateEncoder: JsDataEncoder<Date> = {
  oid: PgOid.TIMESTAMPTZ,
  encodeToText: (value) => value.toISOString(),
  byteLength: 8,
  encodeInto: (buffer, offset, value) =>
    encodeTimestampInto(buffer, offset, Temporal.Instant.fromEpochMilliseconds(value.getTime())),
};

function plainTimeToMicroseconds(value: Temporal.PlainTime): bigint {
  return BigInt(value.hour) * 3_600_000_000n + BigInt(value.minute) * 60_000_000n +
    BigInt(value.second) * 1_000_000n + BigInt(value.millisecond) * 1000n + BigInt(value.microsecond) +
    BigInt(value.nanosecond) / 1000n;
}

function encodeTimestampInto(buffer: Uint8Array, offset: number, value: Temporal.Instant): number {
  const microseconds = (value.epochNanoseconds - POSTGRES_EPOCH_INSTANT.epochNanoseconds) / 1000n;
  return encodeInt64BE(buffer, offset, microseconds);
}
