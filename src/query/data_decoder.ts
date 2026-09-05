export type PgDataDecodeContext = Readonly<{
  typeId: number;
  typeSize: number;
  typeModifier: number;
}>;

export type PgDataDecoder<T = unknown> = {
  text(value: string, context: PgDataDecodeContext): T;
  binary(value: Uint8Array, context: PgDataDecodeContext): T;
};

/**
 * PG Type ID -> DataTypeDecoder
 */
export type PgDataDecoderMap = Readonly<Record<number, PgDataDecoder>>;

export declare const PG_DATA_DECODER_V1: PgDataDecoderMap;
