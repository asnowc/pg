export function decodeInt8(bytes: Uint8Array, offset: number): number {
  return bytes[offset] << 24 >> 24;
}
export function decodeUInt8(bytes: Uint8Array, offset: number): number {
  return bytes[offset];
}
/** @param value UInt8 or Int8 */
export function encodeInt8(bytes: Uint8Array, offset: number, value: number): number {
  bytes[offset] = value;
  return 1;
}

export function decodeInt16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] << 24 >> 16 | bytes[offset + 1];
}
export function decodeUInt16BE(bytes: Uint8Array, offset: number): number {
  return bytes[offset++] << 8 | bytes[offset];
}
/** @param value UInt16 or Int16 */
export function encodeInt16BE(bytes: Uint8Array, offset: number, value: number): number {
  bytes[offset + 1] = value & 0xff;
  value >>= 8;
  bytes[offset] = value & 0xff;
  return 2;
}

export function decodeInt32BE(bytes: Uint8Array, offset: number): number {
  let val = bytes[offset++] << 24;
  val |= bytes[offset++] << 16;
  val |= bytes[offset++] << 8;
  val |= bytes[offset++];
  return val;
}
export function decodeUInt32BE(bytes: Uint8Array, offset: number): number {
  let val = bytes[offset++] << 24;
  val |= bytes[offset++] << 16;
  val |= bytes[offset++] << 8;
  val |= bytes[offset++];
  return val >>> 0;
}
/** @param value UInt32 or Int32 */
export function encodeInt32BE(bytes: Uint8Array, offset: number, value: number): number {
  bytes[offset + 3] = value & 0xff;
  value >>= 8;
  bytes[offset + 2] = value & 0xff;
  value >>= 8;
  bytes[offset + 1] = value & 0xff;
  value >>= 8;
  bytes[offset] = value & 0xff;
  return 4;
}

export function decodeUInt64BE(buf: Uint8Array, offset: number): bigint {
  let tmp = buf[offset++] << 24;
  tmp |= buf[offset++] << 16;
  tmp |= buf[offset++] << 8;
  tmp |= buf[offset++];

  let val = BigInt(tmp >>> 0) << 32n;

  tmp = buf[offset++] << 24;
  tmp |= buf[offset++] << 16;
  tmp |= buf[offset++] << 8;
  tmp |= buf[offset++];
  val |= BigInt(tmp >>> 0);

  return val;
}
export function decodeInt64BE(buf: Uint8Array, offset = 0): bigint {
  let tmp = buf[offset++] << 24;
  tmp |= buf[offset++] << 16;
  tmp |= buf[offset++] << 8;
  tmp |= buf[offset++];

  let val = BigInt(tmp) << 32n;

  tmp = buf[offset++] << 24;
  tmp |= buf[offset++] << 16;
  tmp |= buf[offset++] << 8;
  tmp |= buf[offset++];
  val |= BigInt(tmp >>> 0);

  return val;
}
/** @param value UInt64 or Int64 */
export function encodeInt64BE(bytes: Uint8Array, offset: number, value: bigint): number {
  offset += encodeInt32BE(bytes, offset, Number(value >> 32n));
  offset += encodeInt32BE(bytes, offset, Number(value & 0xffff_ffffn));
  return 8;
}
