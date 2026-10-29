import { StreamReader } from "@/_utils/StreamReader.ts";
import { FieldInfo } from "@/interface/Query.ts";

/** @public */
export type PgDataDecodeContext = {
  typeOID: number;
  typeSize: number;
  typeModifier: number;
};

/** @public */
export type PgDataDecoder<T = unknown> = {
  decodeText(value: string, context: Readonly<PgDataDecodeContext>): T;
  decodeBinary(value: Uint8Array, context: Readonly<PgDataDecodeContext>): T;
};
export type PgColumnDecodeContext = FieldInfo & PgDataDecodeContext & { index: number };
/** @public */
export type PgColumnDecoder<T = unknown> = {
  decodeText(value: string, field: Readonly<PgColumnDecodeContext>): T;
  decodeBinary(value: StreamReader, field: Readonly<PgColumnDecodeContext>, initialValue?: T): T;
};

interface PgDataStreamDecoder<T = unknown> {
  write(data: Uint8Array): void;
  end(): T;
}
type PgDataStreamDecoderFactory<T = unknown> = (context: PgDataDecodeContext) => PgDataStreamDecoder<T>;
/**
 * PG Type ID -> DataTypeDecoder
 * @public
 */
export type PgDataDecoderMap = ReadonlyMap<number, PgDataDecoder>;
