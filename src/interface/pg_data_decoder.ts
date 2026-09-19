/** @public */
export type PgDataDecodeContext = Readonly<{
  typeId: number;
  typeSize: number;
  typeModifier: number;
}>;

/** @public */
export type PgDataDecoder<T = unknown> = {
  text(value: string, context: PgDataDecodeContext): T;
  binary(value: Uint8Array, context: PgDataDecodeContext): T;
};

/**
 * PG Type ID -> DataTypeDecoder
 * @public
 */
export type PgDataDecoderMap = ReadonlyMap<number, PgDataDecoder>;
