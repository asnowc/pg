import { PgDataDecoder } from "@/interface/pg_data_decoder.ts";

const POSTGRES_EPOCH_DATE = Temporal.PlainDate.from("2000-01-01");
const POSTGRES_EPOCH_INSTANT = Temporal.Instant.from("2000-01-01T00:00:00Z");

export const date: PgDataDecoder = {
  decodeText: (value: string) => parseDate(value),
  decodeBinary: (value: Uint8Array) => {
    const days = new DataView(value.buffer, value.byteOffset, value.byteLength).getInt32(0);
    if (days === 0x7fffffff) return "infinity";
    if (days === -0x80000000) return "-infinity";
    return POSTGRES_EPOCH_DATE.add({ days });
  },
};

export const timestamp: PgDataDecoder = {
  decodeText: (value: string) => parsePlainDateTime(value),
  decodeBinary: (value: Uint8Array) => {
    const microseconds = new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0);
    if (microseconds === 0x7fffffffffffffffn) return "infinity";
    if (microseconds === -0x8000000000000000n) return "-infinity";
    return instantFromPostgresMicroseconds(microseconds).toZonedDateTimeISO("UTC").toPlainDateTime();
  },
};

export const timestamptz: PgDataDecoder = {
  decodeText: (value: string) => parseInstant(value),
  decodeBinary: (value: Uint8Array) => {
    const microseconds = new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0);
    if (microseconds === 0x7fffffffffffffffn) return "infinity";
    if (microseconds === -0x8000000000000000n) return "-infinity";
    return instantFromPostgresMicroseconds(microseconds);
  },
};

export const time: PgDataDecoder = {
  decodeText: (value: string) => Temporal.PlainTime.from(value),
  decodeBinary: (value: Uint8Array) => Temporal.PlainTime.from(formatTime(readBigInt64(value))),
};

export const timetz: PgDataDecoder = {
  decodeText: (value: string) => value,
  decodeBinary: (value: Uint8Array) => {
    if (value.byteLength !== 12) throw new RangeError(`Invalid timetz length: ${value.byteLength}`);
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    const secondsWestOfUtc = view.getInt32(8);
    const offset = Math.abs(secondsWestOfUtc);
    const sign = secondsWestOfUtc <= 0 ? "+" : "-";
    return `${formatTime(view.getBigInt64(0))}${sign}${String(Math.floor(offset / 3600)).padStart(2, "0")}:${
      String(
        Math.floor(offset % 3600 / 60),
      ).padStart(2, "0")
    }`;
  },
};

function parseDate(value: string): Temporal.PlainDate | string {
  return value === "infinity" || value === "-infinity" ? value : Temporal.PlainDate.from(value);
}

function parsePlainDateTime(value: string): Temporal.PlainDateTime | string {
  if (value === "infinity" || value === "-infinity") return value;
  return Temporal.PlainDateTime.from(value.replace(" ", "T"));
}

function parseInstant(value: string): Temporal.Instant | string {
  if (value === "infinity" || value === "-infinity") return value;
  return Temporal.Instant.from(value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
}

function instantFromPostgresMicroseconds(microseconds: bigint): Temporal.Instant {
  return Temporal.Instant.fromEpochNanoseconds(POSTGRES_EPOCH_INSTANT.epochNanoseconds + microseconds * 1000n);
}

function readBigInt64(value: Uint8Array): bigint {
  if (value.byteLength !== 8) throw new RangeError(`Invalid int64 length: ${value.byteLength}`);
  return new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0);
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
