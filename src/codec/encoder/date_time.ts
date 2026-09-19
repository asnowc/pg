import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";
import { PgOid } from "@/util/pg_oid.ts";

const POSTGRES_EPOCH_DATE = Temporal.PlainDate.from("2000-01-01");
const POSTGRES_EPOCH_INSTANT = Temporal.Instant.from("2000-01-01T00:00:00Z");

export const plainDateEncoder: JsDataEncoder<Temporal.PlainDate> = {
  getOid: () => PgOid.DATE,
  text: (value) => value.toString(),
  encode: (value) => {
    const output = new Uint8Array(4);
    new DataView(output.buffer).setInt32(0, POSTGRES_EPOCH_DATE.until(value, { largestUnit: "day" }).days);
    return output;
  },
};
export const plainTimeEncoder: JsDataEncoder<Temporal.PlainTime> = {
  getOid: () => PgOid.TIME,
  text: (value) => value.toString(),
  encode: (value) => {
    return encodeInt64(plainTimeToMicroseconds(value));
  },
};
export const plainDateTimeEncoder: JsDataEncoder<Temporal.PlainDateTime> = {
  getOid: () => PgOid.TIMESTAMP,
  text: (value) => value.toString(),
  encode: (value) => encodeTimestamp(value.toZonedDateTime("UTC").toInstant()),
};
export const instantEncoder: JsDataEncoder<Temporal.Instant> = {
  getOid: () => PgOid.TIMESTAMPTZ,
  text: (value) => value.toString(),
  encode: encodeTimestamp,
};
export const dateEncoder: JsDataEncoder<Date> = {
  getOid: () => PgOid.TIMESTAMPTZ,
  text: (value) => value.toISOString(),
  encode: (value) => encodeTimestamp(Temporal.Instant.fromEpochMilliseconds(value.getTime())),
};

function plainTimeToMicroseconds(value: Temporal.PlainTime): bigint {
  return BigInt(value.hour) * 3_600_000_000n + BigInt(value.minute) * 60_000_000n +
    BigInt(value.second) * 1_000_000n + BigInt(value.millisecond) * 1000n + BigInt(value.microsecond) +
    BigInt(value.nanosecond) / 1000n;
}

function encodeTimestamp(value: Temporal.Instant): Uint8Array {
  return encodeInt64((value.epochNanoseconds - POSTGRES_EPOCH_INSTANT.epochNanoseconds) / 1000n);
}

function encodeInt64(value: bigint): Uint8Array {
  const output = new Uint8Array(8);
  new DataView(output.buffer).setBigInt64(0, value);
  return output;
}
