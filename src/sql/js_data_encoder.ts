import { PgOid } from "@/util.ts";

/** @public */
export type JsDataEncoder<T = unknown> = {
  getOid(value: T): number;
  text(value: T, oid: number): string;
  binary(value: T, oid: number): Uint8Array;
};

const encoder = new TextEncoder();
const stringEncoder: JsDataEncoder<string> = {
  getOid: () => PgOid.TEXT,
  text: String,
  binary: (value) => encoder.encode(value),
};
const numberEncoder: JsDataEncoder<number> = {
  getOid: (value) => Number.isInteger(value) ? PgOid.INT4 : PgOid.FLOAT8,
  text: String,
  binary(value, oid) {
    const output = new Uint8Array(oid === PgOid.INT4 ? 4 : 8);
    const view = new DataView(output.buffer);
    oid === PgOid.INT4 ? view.setInt32(0, value) : view.setFloat64(0, value);
    return output;
  },
};
const booleanEncoder: JsDataEncoder<boolean> = {
  getOid: () => PgOid.BOOL,
  text: (value) => value ? "true" : "false",
  binary: (value) => Uint8Array.of(value ? 1 : 0),
};
const bytesEncoder: JsDataEncoder<Uint8Array> = {
  getOid: () => PgOid.BYTEA,
  text: (value) => `\\x${toHex(value)}`,
  binary: (value) => value,
};
const plainDateEncoder: JsDataEncoder<Temporal.PlainDate> = {
  getOid: () => PgOid.DATE,
  text: (value) => value.toString(),
  binary: (value) => {
    const output = new Uint8Array(4);
    new DataView(output.buffer).setInt32(0, POSTGRES_EPOCH_DATE.until(value, { largestUnit: "day" }).days);
    return output;
  },
};
const plainTimeEncoder: JsDataEncoder<Temporal.PlainTime> = {
  getOid: () => PgOid.TIME,
  text: (value) => value.toString(),
  binary: (value) => encodeInt64(plainTimeToMicroseconds(value)),
};
const plainDateTimeEncoder: JsDataEncoder<Temporal.PlainDateTime> = {
  getOid: () => PgOid.TIMESTAMP,
  text: (value) => value.toString(),
  binary: (value) => encodeTimestamp(value.toZonedDateTime("UTC").toInstant()),
};
const instantEncoder: JsDataEncoder<Temporal.Instant> = {
  getOid: () => PgOid.TIMESTAMPTZ,
  text: (value) => value.toString(),
  binary: encodeTimestamp,
};
const dateEncoder: JsDataEncoder<Date> = {
  getOid: () => PgOid.TIMESTAMPTZ,
  text: (value) => value.toISOString(),
  binary: (value) => encodeTimestamp(Temporal.Instant.fromEpochMilliseconds(value.getTime())),
};

const POSTGRES_EPOCH_DATE = Temporal.PlainDate.from("2000-01-01");
const POSTGRES_EPOCH_INSTANT = Temporal.Instant.from("2000-01-01T00:00:00Z");

/** @public */
export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder>;

/** @public */
export const JS_DATA_ENCODER_V1: JsDataEncoderMap = createDataEncoderV1();

function createDataEncoderV1(): JsDataEncoderMap {
  const map = new Map<object | string | number, JsDataEncoder>();
  map.set("string", stringEncoder);
  map.set("number", numberEncoder);
  map.set("boolean", booleanEncoder);
  map.set(Uint8Array, bytesEncoder);
  map.set(Temporal.PlainDate, plainDateEncoder);
  map.set(Temporal.PlainTime, plainTimeEncoder);
  map.set(Temporal.PlainDateTime, plainDateTimeEncoder);
  map.set(Temporal.Instant, instantEncoder);
  map.set(Date, dateEncoder);
  return map;
}

const DATA_TYPE_KEY = Symbol("Data type key");

/** @public */
export function setJsDataTypeFlag<T extends object>(obj: T, flag: string | number): T {
  Reflect.set(obj, DATA_TYPE_KEY, flag);
  return obj;
}

/** @public */
export function getJsDataEncoderSafe(map: JsDataEncoderMap, data: unknown): JsDataEncoder | undefined {
  if (data === null) throw new TypeError(`null cannot be encoded`);
  if (typeof data === "object") {
    const flag = Reflect.get(data, DATA_TYPE_KEY) as string | number | undefined;
    if (flag !== undefined) return map.get(flag);
    let encoder: JsDataEncoder | undefined;
    let constructor = data.constructor;
    while (constructor) {
      encoder = map.get(constructor);
      if (encoder) return encoder;
      constructor = Object.getPrototypeOf(constructor);
    }
    return undefined;
  }
  return map.get(typeof data);
}
/** @public */
export function getJsDataEncoder(map: JsDataEncoderMap, data: unknown): JsDataEncoder {
  const encoder = getJsDataEncoderSafe(map, data);
  if (!encoder) {
    const type = typeof data;
    const dataType = type === "object" && data ? (data as {}).constructor.name : type;
    throw new TypeError(`No JS data encoder for ${dataType}`);
  }
  return encoder;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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
