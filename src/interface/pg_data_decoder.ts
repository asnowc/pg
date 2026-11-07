/** @public */
export type PgColumnDataDecoder<T = unknown> = {
  decodeText(value: string): T;
  /** 返回 undefined，表示数组不足，需等待更多数据。返回其他值表示成功解码。 */
  decodeBinary(value: StreamReader, remainingByteLength: number): T | undefined;
};
/** @public */
export type PgColumnDecoder<T = unknown> =
  | PgColumnDataDecoder<T>
  | (() => PgColumnDataDecoder<T>);
/**
 * @public
 * 字节流读取器。执行读取操作前需要确保有足够的可读字节。
 */
export interface StreamReader {
  readonly buffer: Uint8Array;
  readonly view: DataView;
  get readableEnd(): number;
  /** 当前读取偏移量，即下一个读取操作将从该偏移量开始 */
  readableStart: number;
  /** 可读取的字节长度 */
  get readableLength(): number;
}
