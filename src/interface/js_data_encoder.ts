/** @deprecated  */
export interface JsDataFixedEncoder<T = unknown> {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
  readonly byteLength: number;
  encodeInto(buffer: Uint8Array, offset: number, value: T): number;
}
/** @deprecated  */
export interface JsDataVariableEncoder<T = unknown> {
  oid: number | ((value: T) => number);
  encodeToText(value: T, oid: number): string;
  calculateByteLength(value: T): number;
  encodeInto(buffer: Uint8Array, offset: number, value: T): number;
}
/**
 * @public
 * @deprecated 改为 JsDataEncoder2
 */
export type JsDataEncoder<T = unknown> = JsDataFixedEncoder<T> | JsDataVariableEncoder<T>;
export type JsDataEncoder2<T = unknown> =
  | JsDataVariableLengthEncoder<T>
  | JsDataFixedLengthEncoder<T>;

/** @public */
export interface JsDataFixedLengthEncoder<T = unknown> {
  readonly oid: number;
  readonly byteLength: number;
  encodeToText(value: T): string;
  /**
   * writer.writeableLength 必定大于等于 byteLength
   */
  encodeInto(writer: WriterBuffer, value: T): true;
}
/** @public */
export interface JsDataVariableLengthEncoder<T> {
  readonly oid: number;
  encodeToText(value: T): string;
  startEncode(value: T): StreamEncoder;
}
export type StreamEncoder = {
  readonly byteLength: number;
  /**
   * @returns `false` if encoding is complete, `true` otherwise.
   */
  encodeInto(writer: WriterBuffer): boolean;
};

/**  @deprecated 改为 JsDataEncoderGetter */
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
