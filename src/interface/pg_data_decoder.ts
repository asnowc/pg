import { StreamReader } from "@/_utils/StreamReader.ts";
import { FieldInfo } from "@/interface/Query.ts";

/** @deprecated */
export type PgDataDecoder<T = unknown> = {
  decodeText(value: string, context: Readonly<FieldInfo>): T;
  decodeBinary(value: Uint8Array, context: Readonly<FieldInfo>): T;
};
/** @public */
export type PgColumnDecoder<T = unknown> = {
  decodeText(value: string, field: Readonly<FieldInfo>): T;
  decodeBinary(
    value: StreamReader,
    field: Readonly<FieldInfo>,
    remainingByteLength: number,
    initialValue?: T,
  ): T;
};
