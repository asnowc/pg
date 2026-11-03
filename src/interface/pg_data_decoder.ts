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
  decodeBinary(value: StreamReader, remainingByteLength: number): T | undefined;
};
/** @public */
export type PgColumnDecoder<T> =
  | PgColumnDataDecoder<T>
  | (new (info: Readonly<FieldInfo>) => PgColumnDataDecoder<T>);
