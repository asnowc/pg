import type { PgColumnDataDecoder, PgColumnDecoder } from "@/interface/pg_data_decoder.ts";
import { text } from "./text.ts";

export const json = (() => {
  const decoder = text();
  return {
    decodeText: (value) => JSON.parse(value),
    decodeBinary(reader, remainingByteLength) {
      const value = decoder.decodeBinary(reader, remainingByteLength);
      return value === undefined ? undefined : JSON.parse(value);
    },
  };
}) satisfies PgColumnDecoder;

export const jsonb: PgColumnDecoder = () => {
  let decoder: PgColumnDataDecoder<string> | undefined;
  return {
    decodeText: (value) => JSON.parse(value),
    decodeBinary(reader, remainingByteLength) {
      if (!decoder) {
        if (reader.readableLength < 1) return undefined;
        const version = reader.buffer[reader.readableStart];
        if (version !== 1) throw new RangeError(`Unsupported jsonb version: ${version}`);
        reader.readableStart++;
        remainingByteLength--;
        decoder = text();
      }
      const value = decoder.decodeBinary(reader, remainingByteLength);
      if (value === undefined) return undefined;
      const result = JSON.parse(value);
      decoder = undefined;
      return result;
    },
  };
};
