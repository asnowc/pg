export function writeUint16(output: Uint8Array, offset: number, value: number): number {
  output[offset + 1] = value & 0xff;
  output[offset] = value >> 8;
  return offset + 2;
}

export function writeUint32(output: Uint8Array, offset: number, value: number): number {
  output[offset + 3] = value & 0xff;
  value >>= 8;
  output[offset + 2] = value & 0xff;
  value >>= 8;
  output[offset + 1] = value & 0xff;
  value >>= 8;
  output[offset] = value & 0xff;
  return offset + 4;
}
export function assertUint16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) throw new RangeError(`${name} is out of range`);
}
export function assertInt32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -0x8000_0000 || value > 0x7fff_ffff) {
    throw new RangeError(`${name} is out of range`);
  }
}
export function assertUint32(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    throw new RangeError(`${name} is out of range`);
  }
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

//TODO: 改用 encodeCStringInto
export function encodeCString(value: string): Uint8Array {
  if (value.includes("\0")) throw new Error("PostgreSQL strings cannot contain NUL bytes");
  return textEncoder.encode(value);
}
export function encodeCStringInto(value: string, output: Uint8Array): number {
  const encoded = encodeCString(value);
  if (output.byteLength < encoded.byteLength + 1) throw new RangeError("Output buffer is too small");
  output.set(encoded);
  output[encoded.byteLength] = 0;
  return encoded.byteLength + 1;
}
export function calcCStringByteLength(value: string): number {
  return encodeCString(value).byteLength + 1;
}

export class ByteReader {
  constructor(data: Uint8Array, offset = 0) {
    this.#data = data;
    this.#offset = offset;
    this.#dataView = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }
  #data: Uint8Array;
  #dataView: DataView;
  #offset: number;
  get offset(): number {
    return this.#offset;
  }
  get remaining(): number {
    return this.#data.byteLength - this.#offset;
  }
  get byteLength(): number {
    return this.#data.byteLength;
  }
  readInt8(): number {
    return this.#dataView.getInt8(this.#offset++);
  }
  readInt16(): number {
    const value = this.#dataView.getInt16(this.#offset);
    this.#offset += 2;
    return value;
  }
  readUint16(): number {
    const value = this.#dataView.getUint16(this.#offset);
    this.#offset += 2;
    return value;
  }
  readInt32(): number {
    const value = this.#dataView.getInt32(this.#offset);
    this.#offset += 4;
    return value;
  }
  readUint32(): number {
    const value = this.#dataView.getUint32(this.#offset);
    this.#offset += 4;
    return value;
  }
  readCString(): string {
    const end = this.#data.indexOf(0, this.#offset);
    if (end < 0) throw new Error("unterminated string");
    const value = textDecoder.decode(this.#data.subarray(this.#offset, end));
    this.#offset = end + 1;
    return value;
  }
  readBytes(length = this.remaining): Uint8Array {
    if (!Number.isInteger(length) || length < 0) throw new Error("invalid byte length");
    if (length > this.remaining) throw new Error("message body is truncated");
    const value = this.#data.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }
  readValue(): Uint8Array | null {
    const length = this.readInt32();
    if (length === -1) return null;
    if (length < 0) throw new Error("invalid value length");
    return this.readBytes(length);
  }
}
