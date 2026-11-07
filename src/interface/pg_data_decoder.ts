import { StreamReader } from "@/_utils/StreamReader.ts";
import { FieldInfo } from "@/interface/Query.ts";

/** @deprecated */
export type PgDataDecoder<T = unknown> = {
  decodeText(value: string, context: Readonly<FieldInfo>): T;
  decodeBinary(value: Uint8Array, context: Readonly<FieldInfo>): T;
};
/** @public */
export type PgColumnDataDecoder<T = unknown> = {
  decodeText(value: string): T;
  /** 返回 undefined，表示数组不足，需等待更多数据。返回其他值表示成功解码。 */
  decodeBinary(value: StreamReader, remainingByteLength: number): T | undefined;
};
/** @public */
export type PgColumnDecoder<T> =
  | PgColumnDataDecoder<T>
  | ((info: Readonly<FieldInfo>) => PgColumnDataDecoder<T>);
