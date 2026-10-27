type EncoderCommon<T = unknown> = {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
};
/** @public */
export interface JsDataFixedEncoder<T = unknown> extends EncoderCommon<T> {
  readonly byteLength: number;
  encodeInto(buffer: Uint8Array, offset: number, value: T): number;
}
/** @public */
export interface JsDataVariableEncoder<T = unknown> extends EncoderCommon<T> {
  calculateByteLength(value: T): number;
  encodeInto(buffer: Uint8Array, offset: number, value: T): number;
}
/** @public */
export type JsDataEncoder<T = unknown> = JsDataFixedEncoder<T> | JsDataVariableEncoder<T> | JsDataEncoderDefined<T>;

export interface JsDataEncoderDefined<T = unknown> {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
  calculateByteLength(value: T, oid: number): StreamEncoder;
}
export interface JsDataFixedLengthEncoderDefined<T = unknown> extends StreamEncoder {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
}

export type StreamEncoder = {
  readonly byteLength: number;
  /**
   * @returns `true` if encoding is complete, `false` otherwise.
   */
  encodeInto(writer: WriterBuffer): boolean;
};

/** @public */
export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder<never>>;

export interface WriterBuffer {
  readonly buffer: Uint8Array;
  readonly view: DataView;
  writeOffset: number;
  get writableLength(): number;
}
