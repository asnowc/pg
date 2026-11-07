import type { PgColumnDataDecoder, PgColumnDecoder } from "@/interface/pg_data_decoder.ts";

export const char: PgColumnDataDecoder<string> = {
  decodeText: (value) => value,
  decodeBinary(reader) {
    if (reader.readableLength < 1) return undefined;
    return String.fromCodePoint(reader.buffer[reader.readableStart++]);
  },
};

export const text = (() => {
  const decoder = new TextDecoder();
  let value = "";
  return {
    decodeText: (value) => value,
    decodeBinary(reader, remainingByteLength) {
      const noComplete = reader.readableLength < remainingByteLength;

      const end = Math.min(reader.readableEnd, reader.readableStart + remainingByteLength);
      const chunk = reader.buffer.subarray(reader.readableStart, end);
      reader.readableStart = end;
      if (noComplete) {
        value += decoder.decode(chunk, { stream: noComplete });
        return;
      }
      const result = value + decoder.decode(chunk);
      value = "";
      return result;
    },
  };
}) satisfies PgColumnDecoder<string>;

export const bytea: PgColumnDecoder<Uint8Array> = () => {
  let value: Uint8Array | undefined;
  let offset = 0;
  return {
    decodeText(value: string): Uint8Array {
      if (!value.startsWith("\\x")) return new TextEncoder().encode(value);
      return Uint8Array.fromHex(value.substring(2));
    },
    decodeBinary(reader, remainingByteLength) {
      value ??= new Uint8Array(remainingByteLength);
      const length = Math.min(reader.readableLength, remainingByteLength);
      const chunk = reader.buffer.subarray(reader.readableStart, reader.readableStart + length);
      reader.readableStart += length;
      value.set(chunk, offset);
      offset += length;
      if (length < remainingByteLength) return undefined;
      const result = value;
      value = undefined;
      offset = 0;
      return result;
    },
  };
};

export const uuid: PgColumnDataDecoder<string> = {
  decodeText: (value: string) => value,
  decodeBinary(reader) {
    if (reader.readableLength < 16) return undefined;
    const hex = reader.buffer.subarray(reader.readableStart, reader.readableStart + 16).toHex();
    reader.readableStart += 16;
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
};

export const bitText: PgColumnDataDecoder<string> = {
  decodeText: (value) => value,
  decodeBinary(reader, remainingByteLength) {
    if (reader.readableLength < remainingByteLength) return undefined;
    const bitLength = reader.view.getInt32(reader.readableStart);
    reader.readableStart += 4;
    remainingByteLength -= 4;
    let value = "";
    for (let i = 0; i < remainingByteLength; i++) {
      value += reader.view.getUint8(reader.readableStart).toString(2).padStart(8, "0");
      reader.readableStart++;
    }
    return value.slice(0, bitLength);
  },
};
