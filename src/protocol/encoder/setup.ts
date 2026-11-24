import { CSTRING_TERMINATOR, FRAME_HEADER_LENGTH, FrontendMessageCode, SSL_REQUEST_CODE } from "../const.ts";
import { calcCStringByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";

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
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  let offset = 0;
  (view.setInt32(offset, length), (offset += 4));
  (view.setInt32(offset, version), (offset += 4));

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
  const view = new DataView(request.buffer, request.byteOffset, request.byteLength);
  let offset = 0;
  (view.setInt32(offset, 8), (offset += 4));
  (view.setInt32(offset, SSL_REQUEST_CODE), (offset += 4));
  return request;
}

type PasswordMessage = { password: string } | { data: Uint8Array } | { mechanism: string; data: Uint8Array | null };

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
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    let offset = FRAME_HEADER_LENGTH;
    offset += encodeUTF16StringInto(message.mechanism, buffer.subarray(offset));
    buffer[offset++] = CSTRING_TERMINATOR;
    (view.setInt32(offset, message.data?.byteLength ?? -1), (offset += 4));
    if (message.data) buffer.set(message.data, offset);
    return buffer;
  }
  const buffer = new Uint8Array(5 + message.data.byteLength);
  buffer[0] = FrontendMessageCode.Password;
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setInt32(1, 4 + message.data.byteLength);
  buffer.set(message.data, 5);
  return buffer;
}

function createFrame(code: FrontendMessageCode, bodyLength: number): Uint8Array {
  const buffer = new Uint8Array(FRAME_HEADER_LENGTH + bodyLength);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  view.setUint8(0, code);
  view.setInt32(1, bodyLength + 4);
  return buffer;
}
