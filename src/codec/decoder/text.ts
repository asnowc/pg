const textDecoder = new TextDecoder();

export const text = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => textDecoder.decode(value),
};

export const bytea = {
  text: (value: string) => decodeByteaText(value),
  binary: (value: Uint8Array) => value,
};

export const uuid = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => {
    if (value.byteLength !== 16) throw new RangeError(`Invalid UUID length: ${value.byteLength}`);
    const hex = toHex(value);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  },
};

export const bit = {
  text: (value: string) => value,
  binary: (value: Uint8Array) => {
    if (value.byteLength < 4) throw new RangeError("Invalid bit string");
    const length = new DataView(value.buffer, value.byteOffset, value.byteLength).getInt32(0);
    return Array.from(value.subarray(4), (byte) => byte.toString(2).padStart(8, "0")).join("").slice(0, length);
  },
};

function decodeByteaText(value: string): Uint8Array {
  if (!value.startsWith("\\x")) return new TextEncoder().encode(value);
  const output = new Uint8Array((value.length - 2) / 2);
  for (let index = 0; index < output.length; index++) {
    output[index] = Number.parseInt(value.slice(2 + index * 2, 4 + index * 2), 16);
  }
  return output;
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
