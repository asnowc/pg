import { PgDataDecoder } from "@/interface/pg_data_decoder.ts";

const textDecoder = new TextDecoder();

export const json: PgDataDecoder = {
  decodeText: (value: string) => JSON.parse(value),
  decodeBinary: (value: Uint8Array) => JSON.parse(textDecoder.decode(value)),
};

export const jsonb: PgDataDecoder = {
  decodeText: (value: string) => JSON.parse(value),
  decodeBinary: (value: Uint8Array) => JSON.parse(textDecoder.decode(value.subarray(1))),
};
