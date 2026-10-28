export interface JsDataFixedEncoder<T = unknown> {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
  readonly byteLength: number;
  encodeInto(buffer: Uint8Array, offset: number, value: T): number;
}
export interface JsDataVariableEncoder<T = unknown> {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
  calculateByteLength(value: T): number;
  encodeInto(buffer: Uint8Array, offset: number, value: T): number;
}
/** @public */
export type JsDataEncoder<T = unknown> = JsDataFixedEncoder<T> | JsDataVariableEncoder<T>;
export type JsDataEncoder2 = JsDataEncoderDefined<unknown> | JsDataFixedLengthEncoderDefined<unknown>;
/** @public */
export interface JsDataEncoderDefined<T = unknown> {
  oid: number;
  encodeToText(value: T): string;
  calculateByteLength(value: T): StreamEncoder;
}
/** @public */
export interface JsDataFixedLengthEncoderDefined<T = unknown> extends StreamEncoder {
  oid: number;
  encodeToText(value: T): string;
}

export type StreamEncoder = {
  readonly byteLength: number;
  /**
   * @returns `true` if encoding is complete, `false` otherwise.
   */
  encodeInto(writer: WriterBuffer): boolean;
};

/** @public */
export interface JsDataEncoderGetter<T = unknown> {
  getEncoder(value: T): JsDataEncoder2;
}

/**  改为 JsDataEncoderGetter */
export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder<never>>;

export interface WriterBuffer {
  /** The underlying buffer where data is written. */
  readonly buffer: Uint8Array;
  /** A DataView for convenient reading and writing of different data types. */
  readonly view: DataView;
  /** The current offset in the buffer where the next write will occur. */
  writeOffset: number;
  /** The number of bytes available for writing in the buffer. */
  get writableLength(): number;
}
