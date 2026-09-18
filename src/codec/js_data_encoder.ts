import type { JsDataEncoder, JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { booleanEncoder, bytesEncoder, numberEncoder, stringEncoder } from "./encoder/base.ts";
import {
  dateEncoder,
  instantEncoder,
  plainDateEncoder,
  plainDateTimeEncoder,
  plainTimeEncoder,
} from "./encoder/date_time.ts";

export type {
  JsDataEncoder,
  JsDataEncoderMap,
  JsDataFixedEncoder,
  JsDataVariableEncoder,
} from "@/interface/js_data_encoder.ts";

const DATA_TYPE_KEY = Symbol("Data type key");

/** @public */
export function setJsDataTypeFlag<T extends object>(obj: T, flag: string | number): T {
  Reflect.set(obj, DATA_TYPE_KEY, flag);
  return obj;
}

/** @public */
export function getJsDataEncoderSafe<T>(map: JsDataEncoderMap, data: T): JsDataEncoder<T> | undefined {
  if (data === null) throw new TypeError(`null cannot be encoded`);
  if (typeof data === "object") {
    const flag = Reflect.get(data, DATA_TYPE_KEY) as string | number | undefined;
    if (flag !== undefined) return map.get(flag) as JsDataEncoder<T> | undefined;
    let encoder: JsDataEncoder<never> | undefined;
    let constructor = data.constructor;
    while (constructor) {
      encoder = map.get(constructor);
      if (encoder) return encoder as unknown as JsDataEncoder<T>;
      constructor = Object.getPrototypeOf(constructor);
    }
    return undefined;
  }
  return map.get(typeof data) as JsDataEncoder<T> | undefined;
}
/** @public */
export function getJsDataEncoder<T>(map: JsDataEncoderMap, data: T): JsDataEncoder<T> {
  const encoder = getJsDataEncoderSafe(map, data);
  if (!encoder) {
    const type = typeof data;
    const dataType = type === "object" && data ? (data as {}).constructor.name : type;
    throw new TypeError(`No JS data encoder for ${dataType}`);
  }
  return encoder;
}
/** @public */
export const JS_DATA_ENCODER_V1: JsDataEncoderMap = createJsDataEncoderV1();

/** @__NO_SIDE_EFFECTS__ */
function createJsDataEncoderV1(): JsDataEncoderMap {
  const map = new Map<object | string | number, JsDataEncoder<never>>();
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
