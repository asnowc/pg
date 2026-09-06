import { PgOid } from "../util/pg_oid.ts";

/** @public */
export type PgDataDecodeContext = Readonly<{
  typeId: number;
  typeSize: number;
  typeModifier: number;
}>;

/** @public */
export type PgDataDecoder<T = unknown> = {
  text(value: string, context: PgDataDecodeContext): T;
  binary(value: Uint8Array, context: PgDataDecodeContext): T;
};

/**
 * PG Type ID -> DataTypeDecoder
 * @public
 */
export type PgDataDecoderMap = ReadonlyMap<number, PgDataDecoder>;

const textDecoder = new TextDecoder();
const text = { text: (value: string) => value, binary: (value: Uint8Array) => textDecoder.decode(value) };
const signedInteger = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.byteLength === 2 ? view.getInt16(0) : view.getInt32(0);
  },
};
const bigint = {
  text: (value: string) => BigInt(value),
  binary: (value: Uint8Array) => new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0),
};
const unsignedInteger = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0),
};
const unsignedBigint = {
  text: (value: string) => BigInt(value),
  binary: (value: Uint8Array) => new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(0),
};
const float = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.byteLength === 4 ? view.getFloat32(0) : view.getFloat64(0);
  },
};
const json = {
  text: (value: string) => JSON.parse(value),
  binary: (value: Uint8Array) => JSON.parse(textDecoder.decode(value)),
};
const date = {
  text: (value: string) => parseDate(value),
  binary: (value: Uint8Array) => {
    const days = new DataView(value.buffer, value.byteOffset, value.byteLength).getInt32(0);
    if (days === 0x7fffffff) return "infinity";
    if (days === -0x80000000) return "-infinity";
    return POSTGRES_EPOCH_DATE.add({ days });
  },
};
const timestamp = {
  text: (value: string) => parsePlainDateTime(value),
  binary: (value: Uint8Array) => {
    const microseconds = new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0);
    if (microseconds === 0x7fffffffffffffffn) return "infinity";
    if (microseconds === -0x8000000000000000n) return "-infinity";
    return instantFromPostgresMicroseconds(microseconds).toZonedDateTimeISO("UTC").toPlainDateTime();
  },
};
const timestamptz = {
  text: (value: string) => parseInstant(value),
  binary: (value: Uint8Array) => {
    const microseconds = new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0);
    if (microseconds === 0x7fffffffffffffffn) return "infinity";
    if (microseconds === -0x8000000000000000n) return "-infinity";
    return instantFromPostgresMicroseconds(microseconds);
  },
};
const time = {
  text: (value: string) => Temporal.PlainTime.from(value),
  binary: (value: Uint8Array) => Temporal.PlainTime.from(formatTime(readBigInt64(value))),
};
const timetz = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => {
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
const bytea = {
  text: (value: string) => decodeByteaText(value),
  binary: (value: Uint8Array) => value,
};
const uuid = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => {
    if (value.byteLength !== 16) throw new RangeError(`Invalid UUID length: ${value.byteLength}`);
    const hex = toHex(value);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
};
const bit = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => {
    if (value.byteLength < 4) throw new RangeError("Invalid bit string");
    const length = new DataView(value.buffer, value.byteOffset, value.byteLength).getInt32(0);
    return Array.from(value.subarray(4), (byte) => byte.toString(2).padStart(8, "0")).join("").slice(0, length);
  },
};
const numeric = {
  text: (value: string) => value,
  binary: decodeNumeric,
};
const inet = {
  text: (value: string) => value,
  binary: decodeInet,
};
const macaddr = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join(":"),
};

/** @public */
export const PG_DATA_DECODER_V1: PgDataDecoderMap = createDataDecoderV1();

function createDataDecoderV1(): PgDataDecoderMap {
  const map = new Map<number, PgDataDecoder>();
  map.set(PgOid.BOOL, { text: (value: string) => value === "t", binary: (value: Uint8Array) => value[0] !== 0 });
  map.set(PgOid.BYTEA, bytea);
  map.set(PgOid.CHAR, text);
  map.set(PgOid.NAME, text);
  map.set(PgOid.INT8, bigint);
  map.set(PgOid.INT2, signedInteger);
  map.set(PgOid.INT4, signedInteger);
  map.set(PgOid.TEXT, text);
  map.set(PgOid.OID, unsignedInteger);
  map.set(PgOid.XID, unsignedInteger);
  map.set(PgOid.XID8, unsignedBigint);
  map.set(PgOid.FLOAT4, float);
  map.set(PgOid.FLOAT8, float);
  map.set(PgOid.DATE, date);
  map.set(PgOid.TIME, time);
  map.set(PgOid.TIMESTAMP, timestamp);
  map.set(PgOid.TIMESTAMPTZ, timestamptz);
  map.set(PgOid.TIMETZ, timetz);
  map.set(PgOid.INTERVAL, text);
  map.set(PgOid.NUMERIC, numeric);
  map.set(PgOid.BPCHAR, text);
  map.set(PgOid.VARCHAR, text);
  map.set(PgOid.XML, text);
  map.set(PgOid.JSON, json);
  map.set(PgOid.JSONB, {
    text: (value: string) => JSON.parse(value),
    binary: (value: Uint8Array) => JSON.parse(textDecoder.decode(value.subarray(1))),
  });
  map.set(PgOid.UUID, uuid);
  map.set(PgOid.BIT, bit);
  map.set(PgOid.VARBIT, bit);
  map.set(PgOid.REGCLASS, unsignedInteger);
  map.set(PgOid.INET, inet);
  map.set(PgOid.MACADDR, macaddr);
  map.set(PgOid.MACADDR8, macaddr);
  map.set(PgOid.UNKNOWN, text);
  return map;
}

const POSTGRES_EPOCH_DATE = Temporal.PlainDate.from("2000-01-01");
const POSTGRES_EPOCH_INSTANT = Temporal.Instant.from("2000-01-01T00:00:00Z");

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

function decodeByteaText(value: string): Uint8Array {
  if (!value.startsWith("\\x")) return new TextEncoder().encode(value);
  const output = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < output.length; index++) {
    output[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return output;
}

function decodeNumeric(value: Uint8Array): string {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  if (value.byteLength < 8) throw new RangeError("Invalid numeric value");
  const digitCount = view.getUint16(0);
  const weight = view.getInt16(2);
  const sign = view.getUint16(4);
  const scale = view.getUint16(6);
  if (value.byteLength !== 8 + digitCount * 2) throw new RangeError("Invalid numeric value");
  if (sign === 0xc000) return "NaN";
  if (sign === 0xd000) return "Infinity";
  if (sign === 0xf000) return "-Infinity";
  if (sign !== 0 && sign !== 0x4000) throw new RangeError(`Invalid numeric sign: ${sign}`);

  const groups = Array.from({ length: digitCount }, (_, index) => view.getUint16(8 + index * 2));
  const integerGroups = Math.max(weight + 1, 0);
  let integer = integerGroups === 0 ? "0" : Array.from({ length: integerGroups }, (_, index) => {
    const group = groups[index] ?? 0;
    return index === 0 ? String(group) : String(group).padStart(4, "0");
  }).join("");
  integer = integer.replace(/^0+(?=\d)/, "");
  const fractionGroups = Math.ceil(scale / 4);
  const fraction = Array.from({ length: fractionGroups }, (_, index) => {
    const groupIndex = index + weight + 1;
    return String(groupIndex >= 0 ? groups[groupIndex] ?? 0 : 0).padStart(4, "0");
  }).join("").slice(0, scale);
  return `${sign === 0x4000 ? "-" : ""}${integer}${scale > 0 ? `.${fraction}` : ""}`;
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

function decodeInet(value: Uint8Array): string {
  if (value.byteLength < 4) throw new RangeError("Invalid inet value");
  const family = value[0];
  const mask = value[1];
  const isCidr = value[2] !== 0;
  const length = value[3];
  const address = value.subarray(4);
  if (address.byteLength !== length) throw new RangeError("Invalid inet address length");

  let output: string;
  let fullMask: number;
  if (family === 2 && length === 4) {
    output = address.join(".");
    fullMask = 32;
  } else if (family === 3 && length === 16) {
    const groups = Array.from(
      { length: 8 },
      (_, index) => new DataView(address.buffer, address.byteOffset + index * 2, 2).getUint16(0).toString(16),
    );
    output = compressIpv6(groups);
    fullMask = 128;
  } else {
    throw new RangeError(`Unsupported inet family: ${family}`);
  }
  return isCidr || mask !== fullMask ? `${output}/${mask}` : output;
}

function compressIpv6(groups: string[]): string {
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < groups.length;) {
    if (groups[index] !== "0") {
      index++;
      continue;
    }
    let end = index;
    while (end < groups.length && groups[end] === "0") end++;
    if (end - index > bestLength) [bestStart, bestLength] = [index, end - index];
    index = end;
  }
  if (bestLength < 2) return groups.join(":");
  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
