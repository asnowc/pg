/** @public */
export type PgDataDecodeContext = Readonly<{
  typeId: number;
  typeSize: number;
  typeModifier: number;
}>;

/** @public */
export type PgDataDecoder<T = unknown> = {
  decodeText(value: string, context: PgDataDecodeContext): T;
  decodeBinary(value: Uint8Array, context: PgDataDecodeContext): T;
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
