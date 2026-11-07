import {
  CSTRING_TERMINATOR,
  DescribeTarget,
  FRAME_HEADER_LENGTH,
  FrontendMessageCode,
  SSL_REQUEST_CODE,
} from "./const.ts";
import { calcCStringByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";
import { encodeInt32BE } from "@/_utils/number.ts";

function encodeFrameHeaderInto(
  buffet: Uint8Array,
  offset: number,
  code: FrontendMessageCode,
  bodyLength: number,
): number {
  buffet[offset++] = code;
  offset += encodeInt32BE(buffet, offset, bodyLength + 4);
  return offset;
}

/**
 * 仅发送 StartupMessage。
 */
export function encodeStartupMessage(version: number, parameters: Map<string, string>): Uint8Array {
  let length = 9;
  for (const [key, value] of parameters) {
    length += calcCStringByteLength(key) + calcCStringByteLength(value);
    length += 2; // for the null terminators of key and value
  }
  const message = new Uint8Array(length);
  let offset = encodeInt32BE(message, 0, length);
  offset += encodeInt32BE(message, 4, version);

  for (const [key, value] of parameters) {
    offset += encodeUTF16StringInto(key, message.subarray(offset));
    message[offset++] = CSTRING_TERMINATOR;
    offset += encodeUTF16StringInto(value, message.subarray(offset));
    message[offset++] = CSTRING_TERMINATOR;
  }
  return message;
}

export function encodeNegotiateTlsMessage(): Uint8Array {
  const request = new Uint8Array(8);
  let offset = 0;
  offset += encodeInt32BE(request, offset, 8);
  offset += encodeInt32BE(request, offset, SSL_REQUEST_CODE);
  return request;
}

type PasswordMessage =
  | { password: string }
  | { data: Uint8Array }
  | { mechanism: string; data: Uint8Array | null };

export function encodePasswordMessage(message: PasswordMessage): Uint8Array {
  if ("password" in message) {
    const bodyLength = calcCStringByteLength(message.password) + 1;
    const buffer = createFrame(FrontendMessageCode.Password, bodyLength);

    let offset = FRAME_HEADER_LENGTH;
    offset += encodeUTF16StringInto(message.password, buffer.subarray(offset));
    buffer[offset++] = CSTRING_TERMINATOR;
    return buffer;
  }
  if ("mechanism" in message) {
    const mechanismByteLength = calcCStringByteLength(message.mechanism);
    const bodyLength = mechanismByteLength + 5 + (message.data?.byteLength ?? 0);
    const buffer = createFrame(FrontendMessageCode.Password, bodyLength);

    let offset = FRAME_HEADER_LENGTH;
    offset += encodeUTF16StringInto(message.mechanism, buffer.subarray(offset));
    buffer[offset++] = CSTRING_TERMINATOR;
    offset += encodeInt32BE(buffer, offset, message.data?.byteLength ?? -1);
    if (message.data) buffer.set(message.data, offset);
    return buffer;
  }
  const buffer = new Uint8Array(5 + message.data.byteLength);
  buffer[0] = FrontendMessageCode.Password;
  encodeInt32BE(buffer, 1, 4 + message.data.byteLength);
  buffer.set(message.data, 5);
  return buffer;
}

export function encodeCloseMessage(target: DescribeTarget, name?: Uint8Array): Uint8Array {
  const bodyLength = name ? name.byteLength + 2 : 2;
  const buffer = createFrame(FrontendMessageCode.Close, bodyLength);
  let offset = FRAME_HEADER_LENGTH;
  buffer[offset++] = target;
  if (name) {
    buffer.set(name, offset);
    offset += name.byteLength;
  }
  buffer[offset++] = CSTRING_TERMINATOR;
  return buffer;
}

export function encodeCopyDataMessage(data: Uint8Array): Uint8Array {
  const bodyLength = data.byteLength;
  const buffer = createFrame(FrontendMessageCode.CopyData, bodyLength);
  buffer.set(data, FRAME_HEADER_LENGTH);
  return buffer;
}

export function encodeCopyFailMessage(reason: string): Uint8Array {
  const bodyLength = calcCStringByteLength(reason) + 1;
  const buffer = createFrame(FrontendMessageCode.CopyFail, bodyLength);
  const offset = FRAME_HEADER_LENGTH + encodeUTF16StringInto(reason, buffer.subarray(FRAME_HEADER_LENGTH));
  buffer[offset] = CSTRING_TERMINATOR;
  return buffer;
}
function createFrame(code: FrontendMessageCode, bodyLength: number): Uint8Array {
  const buffer = new Uint8Array(FRAME_HEADER_LENGTH + bodyLength);
  encodeFrameHeaderInto(buffer, 0, code, bodyLength);
  return buffer;
}
