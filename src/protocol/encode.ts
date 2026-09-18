import { FrontendMessageCode, SSL_REQUEST_CODE } from "./const.ts";
import { calcUTF16ByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";
import { encodeInt32BE } from "@/_utils/number.ts";

const FRAME_HEADER_LENGTH = 5;
const MAX_BODY_LENGTH = 0x7fff_fffb;
const CSTRING_TERMINATOR = 0;

function assertWrittenLength(output: Uint8Array, offset: number): Uint8Array {
  if (offset !== output.byteLength) throw new Error("PostgreSQL message length mismatch");
  return output;
}

function encodeFrameHeaderInto(
  buffet: Uint8Array,
  offset: number,
  code: FrontendMessageCode,
  bodyLength: number,
): number {
  buffet[offset++] = code;
  return encodeInt32BE(buffet, offset, bodyLength + 4);
}

/**
 * 仅发送 StartupMessage。
 */
export function encodeStartupMessage(version: number, parameters: Map<string, string>): Uint8Array {
  let length = 9;
  for (const [key, value] of parameters) {
    length += calcUTF16ByteLength(key) + calcUTF16ByteLength(value);
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
    const bodyLength = calcUTF16ByteLength(message.password) + 1;
    const buffer = createFrame(FrontendMessageCode.Password, bodyLength);

    let offset = FRAME_HEADER_LENGTH;
    offset += encodeUTF16StringInto(message.password, buffer.subarray(offset));
    buffer[offset++] = CSTRING_TERMINATOR;
    return buffer;
  }
  if ("mechanism" in message) {
    const mechanismByteLength = calcUTF16ByteLength(message.mechanism);
    const bodyLength = mechanismByteLength + 5 + (message.data?.byteLength ?? 0);
    const buffer = createFrame(FrontendMessageCode.Password, bodyLength);

    let offset = FRAME_HEADER_LENGTH;
    offset += encodeUTF16StringInto(message.mechanism, buffer.subarray(offset));
    buffer[offset++] = CSTRING_TERMINATOR;
    offset = encodeInt32BE(buffer, offset, message.data?.byteLength ?? -1);
    if (message.data) buffer.set(message.data, offset);
    return buffer;
  }
  const buffer = new Uint8Array(5 + message.data.byteLength);
  buffer[0] = FrontendMessageCode.Password;
  encodeInt32BE(buffer, 1, 4 + message.data.byteLength);
  buffer.set(message.data, 5);
  return buffer;
}

export interface SimpleQueryEncoder {
  calculateByteLength(): number;
  encodeQueryInto(data: Uint8Array, offset: number): number;
}
export function encodeQueryMessage(data: SimpleQueryEncoder): Uint8Array {
  const bodyLength = data.calculateByteLength();
  const buffer = new Uint8Array(bodyLength + FRAME_HEADER_LENGTH);
  const offset = data.encodeQueryInto(buffer, FRAME_HEADER_LENGTH);
  assertWrittenLength(buffer, offset);
  encodeFrameHeaderInto(buffer, 0, FrontendMessageCode.Query, bodyLength);
  return buffer;
}

export interface ParseStatementEncoder {
  calculateParseByteLength(): number;
  encodeParseInto(data: Uint8Array, offset: number): number;
}

export function encodeParseMessageInto(
  buffer: Uint8Array,
  offset: number,
  statement: Pick<ParseStatementEncoder, "encodeParseInto">,
  messageByteLength: number,
): number {
  offset = encodeFrameHeaderInto(buffer, offset, FrontendMessageCode.Parse, messageByteLength);
  return statement.encodeParseInto(buffer, offset);
}
export function encodeParseMessage(statement: ParseStatementEncoder): Uint8Array {
  const byteLength = statement.calculateParseByteLength();
  const buffer = createFrame(FrontendMessageCode.Parse, byteLength);
  statement.encodeParseInto(buffer, FRAME_HEADER_LENGTH);
  return buffer;
}

export interface BindStatementEncoder {
  calculateBindByteLength(): number;
  encodeBindInto(data: Uint8Array, offset: number): number;
}
export function encodeBindMessage(data: BindStatementEncoder): Uint8Array {
  const bodyLength = data.calculateBindByteLength();
  const buffer = createFrame(FrontendMessageCode.Bind, bodyLength);
  const offset = data.encodeBindInto(buffer, FRAME_HEADER_LENGTH);
  assertWrittenLength(buffer, offset);
  return buffer;
}
export enum DescribeTarget {
  Statement = 0x53,
  Portal = 0x50,
}
/**
 * @param target 0x53: statement, 0x50: portal
 */
export function encodeDescribeMessage(target: DescribeTarget, name?: Uint8Array) {
  const bodyLength = name ? name.byteLength + 2 : 2;
  const buffer = createFrame(FrontendMessageCode.Describe, bodyLength);
  let offset = FRAME_HEADER_LENGTH;
  buffer[offset++] = target;
  if (name) {
    buffer.set(name, offset);
    offset += name.byteLength;
  }
  buffer[offset++] = CSTRING_TERMINATOR;
  return buffer;
}
export function encodeExecuteMessage(maxRows: number, portal?: Uint8Array): Uint8Array {
  const bodyLength = portal ? portal.byteLength + 5 : 5;
  const buffer = createFrame(FrontendMessageCode.Execute, bodyLength);
  let offset = FRAME_HEADER_LENGTH;
  if (portal) {
    buffer.set(portal, offset);
    offset += portal.byteLength;
  }
  buffer[offset++] = CSTRING_TERMINATOR;
  offset = encodeInt32BE(buffer, offset, maxRows);
  assertWrittenLength(buffer, offset);
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
  const bodyLength = calcUTF16ByteLength(reason) + 1;
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

export function encodeTerminateMessage(): Uint8Array {
  return createFrame(FrontendMessageCode.Terminate, 0);
}
