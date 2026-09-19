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
export type JsDataEncoder<T = unknown> = JsDataFixedEncoder<T> | JsDataVariableEncoder<T>;

//TODO: 待定
interface JsDataStreamEncoder<T = unknown> extends EncoderCommon<T> {
  calculateByteLength(value: T): StreamEncoder;
}

type StreamEncoder = {
  readonly byteLength: number;
  /**
   * @returns 返回累计编码的大小。当这个值等于 byteLength 时，表示编码完成。否则应继续调用 encodeInto 进行编码。
   */
  encodeInto(buffer: Uint8Array, offset: number): number;
};

/** @public */
export type JsDataEncoderMap = ReadonlyMap<object | string | number, JsDataEncoder<never>>;
