import type { JsDataEncoder, JSDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { booleanEncoder, bytesEncoder, f64Encoder, int4Encoder, stringEncoder } from "./encoder/base.ts";
import {
  dateEncoder,
  instantEncoder,
  plainDateEncoder,
  plainDateTimeEncoder,
  plainTimeEncoder,
} from "./encoder/date_time.ts";

const DATA_TYPE_KEY = Symbol("Data type key");

/** @public */
export function setJsDataTypeFlag<T extends object>(obj: T, flag: string | number): T {
  Reflect.set(obj, DATA_TYPE_KEY, flag);
  return obj;
}
function getObjectDataEncoder<C, T extends object>(map: ReadonlyMap<any, C>, data: T): C | undefined {
  const flag = Reflect.get(data, DATA_TYPE_KEY) as string | number | undefined;
  if (flag !== undefined) return map.get(flag);
  let encoder: C | undefined;
  let constructor = data.constructor;
  while (constructor) {
    encoder = map.get(constructor);
    if (encoder) return encoder;
    constructor = Object.getPrototypeOf(constructor);
  }
  return undefined;
}

/** @public */
export function getJsDataEncoderSafe<T>(map: JSDataEncoderMap, data: T): JsDataEncoder<T> | undefined {
  if (data === null) throw new TypeError(`null cannot be encoded`);
  const encoder = typeof data === "object" ? getObjectDataEncoder(map, data) : map.get(typeof data);
  if (!encoder) return undefined;
  return typeof encoder === "function" ? encoder(data) : encoder;
}
/** @public */
export function getJsDataEncoder<T>(map: JSDataEncoderMap, data: T): JsDataEncoder<T> {
  const encoder = getJsDataEncoderSafe(map, data);
  if (!encoder) {
    const type = typeof data;
    const dataType = type === "object" && data ? (data as {}).constructor.name : type;
    throw new TypeError(`No PostgreSQL encoder for ${dataType}`);
  }
  return encoder;
}
/** @public */
export const JS_DATA_ENCODER_V1: JSDataEncoderMap = createJsDataEncoderV1();

/** @__NO_SIDE_EFFECTS__ */
function createJsDataEncoderV1(): JSDataEncoderMap {
  const map = new Map<Function | string | number, JsDataEncoder | ((value: unknown) => JsDataEncoder)>();
  map.set("string", stringEncoder);
  map.set("number", (value) => Number.isInteger(value) ? int4Encoder : f64Encoder);
  map.set("boolean", booleanEncoder);
  map.set(Uint8Array, bytesEncoder);
  map.set(Temporal.PlainDate, plainDateEncoder);
  map.set(Temporal.PlainTime, plainTimeEncoder);
  map.set(Temporal.PlainDateTime, plainDateTimeEncoder);
  map.set(Temporal.Instant, instantEncoder);
  map.set(Date, dateEncoder);
  return map;
}
