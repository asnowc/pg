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
export type PgDataDecoderMap = Readonly<Record<number, PgDataDecoder>>;

const text = { text: (value: string) => value, binary: (value: Uint8Array) => value };
const integer = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.byteLength === 2 ? view.getInt16(0) : value.byteLength === 4 ? view.getInt32(0) : view.getBigInt64(0);
  },
};
const float = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.byteLength === 4 ? view.getFloat32(0) : view.getFloat64(0);
  },
};
const json = {
  text: (value: string) => JSON.parse(value),
  binary: (value: Uint8Array) => JSON.parse(new TextDecoder().decode(value)),
};

const defaultDecoders: Record<number, PgDataDecoder> = {
  16: { text: (value: string) => value === "t", binary: (value: Uint8Array) => value[0] !== 0 },
  17: { text: (value: string) => value, binary: (value: Uint8Array) => value },
  20: integer,
  21: integer,
  23: integer,
  25: text,
  26: integer,
  700: float,
  701: float,
  114: json,
  3802: {
    text: (value: string) => JSON.parse(value),
    binary: (value: Uint8Array) => JSON.parse(new TextDecoder().decode(value.subarray(1))),
  },
};
/** @public */
export const PG_DATA_DECODER_V1: PgDataDecoderMap = Object.freeze(defaultDecoders);
