import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";

const POSTGRES_EPOCH_DATE = Temporal.PlainDate.from("2000-01-01");
const POSTGRES_EPOCH_INSTANT = Temporal.Instant.from("2000-01-01T00:00:00Z");

export const date: PgColumnDataDecoder<Temporal.PlainDate | number> = {
  decodeText: (value: string) => parseDate(value),
  decodeBinary(reader) {
    if (reader.readableLength < 4) return undefined;
    const days = reader.view.getInt32(reader.readableStart);
    reader.readableStart += 4;
    if (days === 0x7fffffff) return Infinity;
    if (days === -0x80000000) return -Infinity;
    return POSTGRES_EPOCH_DATE.add({ days });
  },
};

export const timestamp: PgColumnDataDecoder<Temporal.PlainDateTime | number> = {
  decodeText: (value: string) => parsePlainDateTime(value),
  decodeBinary(reader) {
    if (reader.readableLength < 8) return undefined;
    const microseconds = reader.view.getBigInt64(reader.readableStart);
    reader.readableStart += 8;
    if (microseconds === 0x7fffffffffffffffn) return Infinity;
    if (microseconds === -0x8000000000000000n) return -Infinity;
    return instantFromPostgresMicroseconds(microseconds).toZonedDateTimeISO("UTC").toPlainDateTime();
  },
};

export const timestamptz: PgColumnDataDecoder<Temporal.Instant | number> = {
  decodeText: (value: string) => parseInstant(value),
  decodeBinary(reader) {
    if (reader.readableLength < 8) return undefined;
    const microseconds = reader.view.getBigInt64(reader.readableStart);
    reader.readableStart += 8;
    if (microseconds === 0x7fffffffffffffffn) return Infinity;
    if (microseconds === -0x8000000000000000n) return -Infinity;
    return instantFromPostgresMicroseconds(microseconds);
  },
};

export const time: PgColumnDataDecoder<Temporal.PlainTime> = {
  decodeText: (value: string) => Temporal.PlainTime.from(value),
  decodeBinary(reader) {
    if (reader.readableLength < 8) return undefined;
    const microseconds = reader.view.getBigInt64(reader.readableStart);
    reader.readableStart += 8;
    return Temporal.PlainTime.from(formatTime(microseconds));
  },
};

export const timetz: PgColumnDataDecoder<string> = {
  decodeText: (value: string) => value,
  decodeBinary(reader) {
    if (reader.readableLength < 12) return undefined;
    const microseconds = reader.view.getBigInt64(reader.readableStart);
    reader.readableStart += 8;
    const secondsWestOfUtc = reader.view.getInt32(reader.readableStart);
    reader.readableStart += 4;
    const offset = Math.abs(secondsWestOfUtc);
    const sign = secondsWestOfUtc <= 0 ? "+" : "-";
    return `${formatTime(microseconds)}${sign}${String(Math.floor(offset / 3600)).padStart(2, "0")}:${
      String(
        Math.floor(offset % 3600 / 60),
      ).padStart(2, "0")
    }`;
  },
};

function parseDate(value: string): Temporal.PlainDate | number {
  if (value === "infinity") return Infinity;
  if (value === "-infinity") return -Infinity;
  return Temporal.PlainDate.from(value);
}

function parsePlainDateTime(value: string): Temporal.PlainDateTime | number {
  if (value === "infinity") return Infinity;
  if (value === "-infinity") return -Infinity;
  return Temporal.PlainDateTime.from(value.replace(" ", "T"));
}

function parseInstant(value: string): Temporal.Instant | number {
  if (value === "infinity") return Infinity;
  if (value === "-infinity") return -Infinity;
  return Temporal.Instant.from(value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
}

function instantFromPostgresMicroseconds(microseconds: bigint): Temporal.Instant {
  return Temporal.Instant.fromEpochNanoseconds(POSTGRES_EPOCH_INSTANT.epochNanoseconds + microseconds * 1000n);
}

function formatTime(microseconds: bigint): string {
  const hours = microseconds / 3_600_000_000n;
  const minutes = microseconds / 60_000_000n % 60n;
  const seconds = microseconds / 1_000_000n % 60n;
  const fraction = microseconds % 1_000_000n;
  const base = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${
    String(seconds).padStart(2, "0")
  }`;
  return fraction === 0n ? base : `${base}.${String(fraction).padStart(6, "0").replace(/0+$/, "")}`;
}
