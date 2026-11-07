export type JsDataEncoder<T = unknown> =
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
  encodeInto(writer: WriterBuffer, value: T): void;
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

export type JSDataEncoderMap = ReadonlyMap<
  object | string | number,
  JsDataEncoder<unknown> | ((value: unknown) => JsDataEncoder<unknown>)
>;

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
