import type { PgColumnDataDecoder, PgColumnDecoder } from "@/interface/pg_data_decoder.ts";

export const boolean: PgColumnDataDecoder<boolean> = {
  decodeText: (value: string) => value === "t",
  decodeBinary(reader) {
    if (reader.readableLength < 1) return undefined;
    const value = reader.view.getUint8(reader.readableStart);
    reader.readableStart++;
    return value !== 0;
  },
};

export const int32: PgColumnDataDecoder<number> = {
  decodeText: (value: string) => Number(value),
  decodeBinary(reader, remainingByteLength) {
    const length = remainingByteLength === 2 ? 2 : 4;
    if (reader.readableLength < length) return undefined;
    const value = length === 2
      ? reader.view.getInt16(reader.readableStart)
      : reader.view.getInt32(reader.readableStart);
    reader.readableStart += length;
    return value;
  },
};

export const int64: PgColumnDataDecoder<bigint> = {
  decodeText: (value: string) => BigInt(value),
  decodeBinary(reader) {
    if (reader.readableLength < 8) return undefined;
    const value = reader.view.getBigInt64(reader.readableStart);
    reader.readableStart += 8;
    return value;
  },
};

export const uInt32: PgColumnDataDecoder<number> = {
  decodeText: (value: string) => Number(value),
  decodeBinary(reader) {
    if (reader.readableLength < 4) return undefined;
    const value = reader.view.getUint32(reader.readableStart);
    reader.readableStart += 4;
    return value;
  },
};

export const uInt64: PgColumnDataDecoder<bigint> = {
  decodeText: (value: string) => BigInt(value),
  decodeBinary(reader) {
    if (reader.readableLength < 8) return undefined;
    const value = reader.view.getBigUint64(reader.readableStart);
    reader.readableStart += 8;
    return value;
  },
};

export const float32: PgColumnDataDecoder<number> = {
  decodeText: (value: string) => Number(value),
  decodeBinary(reader) {
    if (reader.readableLength < 4) return undefined;
    const value = reader.view.getFloat32(reader.readableStart);
    reader.readableStart += 4;
    return value;
  },
};
export const float64: PgColumnDataDecoder<number> = {
  decodeText: (value: string) => Number(value),
  decodeBinary(reader) {
    if (reader.readableLength < 8) return undefined;
    const value = reader.view.getFloat64(reader.readableStart);
    reader.readableStart += 8;
    return value;
  },
};
export const numeric: PgColumnDecoder<string> = () => {
  let digitCount: number | undefined;
  let weight = 0;
  let sign = 0;
  let scale = 0;
  let groups: number[] = [];
  return {
    decodeText: (value) => value,
    decodeBinary(reader) {
      if (digitCount === undefined) {
        if (reader.readableLength < 8) return undefined;
        digitCount = reader.view.getUint16(reader.readableStart);
        reader.readableStart += 2;
        weight = reader.view.getInt16(reader.readableStart);
        reader.readableStart += 2;
        sign = reader.view.getUint16(reader.readableStart);
        reader.readableStart += 2;
        scale = reader.view.getUint16(reader.readableStart);
        reader.readableStart += 2;
      }
      while (groups.length < digitCount) {
        if (reader.readableLength < 2) return undefined;
        groups.push(reader.view.getUint16(reader.readableStart));
        reader.readableStart += 2;
      }
      const result = formatNumeric(groups, weight, sign, scale);
      digitCount = undefined;
      groups = [];
      return result;
    },
  };
};

function formatNumeric(groups: number[], weight: number, sign: number, scale: number): string {
  if (sign === 0xc000) return "NaN";
  if (sign === 0xd000) return "Infinity";
  if (sign === 0xf000) return "-Infinity";
  if (sign !== 0 && sign !== 0x4000) throw new RangeError(`Invalid numeric sign: ${sign}`);

  const integerGroups = Math.max(weight + 1, 0);
  let integer = integerGroups === 0 ? "0" : Array.from({ length: integerGroups }, (_, index) => {
    const group = groups[index] ?? 0;
    return index === 0 ? String(group) : String(group).padStart(4, "0");
  }).join("");
  integer = integer.replace(/^0+(?=\d)/, "");
  const fractionGroups = Math.ceil(scale / 4);
  const fraction = Array.from({ length: fractionGroups }, (_, index) => {
    const groupIndex = index + weight + 1;
    return String(groupIndex >= 0 ? groups[groupIndex] ?? 0 : 0).padStart(4, "0");
  }).join("").slice(0, scale);
  return `${sign === 0x4000 ? "-" : ""}${integer}${scale > 0 ? `.${fraction}` : ""}`;
}
