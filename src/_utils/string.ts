const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Calculates the byte length of a UTF-16 string when encoded as UTF-8.
 * Throws an error if the string contains NUL bytes.
 */
export function calcUTF16ByteLength(str: string): number {
  let utf8Len = 0;
  let code: number;
  let i = 0;
  const max = str.length;
  while (i < max) {
    code = str.codePointAt(i)!;
    if (code === 0) throw new Error("PostgreSQL strings cannot contain NUL bytes");
    else if (code < 0x80) utf8Len++;
    else if (code < 0x8_00) utf8Len += 2;
    else if (code < 0x10000) utf8Len += 3;
    else if (code < 0x200000) utf8Len += 4;
    else if (code < 0x4000000) utf8Len += 5;
    else utf8Len += 6;

    if (code > 0xffff) i += 2;
    else i++;
  }

  return utf8Len;
}
export function encodeUTF16StringInto(value: string, output: Uint8Array): number {
  const result = textEncoder.encodeInto(value, output);
  if (result.read !== value.length) throw new RangeError("Insufficient UTF-8 output buffer");
  return result.written;
}
export function decodeUTF16String(data: Uint8Array) {
  return textDecoder.decode(data);
}
export function findCStringTerminator(data: Uint8Array, offset: number = 0): number {
  const end = data.indexOf(0, offset);
  return end === -1 ? data.byteLength : end;
}
//TODO: 性能优化
export function encodeBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

//TODO: 性能优化
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
