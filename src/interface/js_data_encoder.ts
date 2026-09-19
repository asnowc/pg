/** @public */
export type JsDataEncoder<T = unknown> = {
  getOid(value: T): number;
  text(value: T, oid: number): string;
  encode(value: T, oid: number): Uint8Array;
};

/** @public */
export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder>;
