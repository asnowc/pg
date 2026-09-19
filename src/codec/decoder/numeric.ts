export const boolean = {
  text: (value: string) => value === "t",
  binary: (value: Uint8Array) => value[0] !== 0,
};

export const signedInteger = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.byteLength === 2 ? view.getInt16(0) : view.getInt32(0);
  },
};

export const bigint = {
  text: (value: string) => BigInt(value),
  binary: (value: Uint8Array) => new DataView(value.buffer, value.byteOffset, value.byteLength).getBigInt64(0),
};

export const unsignedInteger = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => new DataView(value.buffer, value.byteOffset, value.byteLength).getUint32(0),
};

export const unsignedBigint = {
  text: (value: string) => BigInt(value),
  binary: (value: Uint8Array) => new DataView(value.buffer, value.byteOffset, value.byteLength).getBigUint64(0),
};

export const float = {
  text: (value: string) => Number(value),
  binary: (value: Uint8Array) => {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return value.byteLength === 4 ? view.getFloat32(0) : view.getFloat64(0);
  },
};

export const numeric = {
  text: (value: string) => value,
  binary: decodeNumeric,
};

function decodeNumeric(value: Uint8Array): string {
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  if (value.byteLength < 8) throw new RangeError("Invalid numeric value");
  const digitCount = view.getUint16(0);
  const weight = view.getInt16(2);
  const sign = view.getUint16(4);
  const scale = view.getUint16(6);
  if (value.byteLength !== 8 + digitCount * 2) throw new RangeError("Invalid numeric value");
  if (sign === 0xc000) return "NaN";
  if (sign === 0xd000) return "Infinity";
  if (sign === 0xf000) return "-Infinity";
  if (sign !== 0 && sign !== 0x4000) throw new RangeError(`Invalid numeric sign: ${sign}`);

  const groups = Array.from({ length: digitCount }, (_, index) => view.getUint16(8 + index * 2));
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
