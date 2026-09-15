import { FRONTEND_MSG_CODE } from "./const.ts";
import type { PgFrontendMessage } from "./messages.ts";
import {
  assertInt32,
  assertUint16,
  assertUint32,
  encodeCString,
  writeUint16,
  writeUint32,
} from "@/_utils/data_type_bin.ts";
import { FRAME } from "./_static_frame.ts";
export { FRAME };

const FRAME_HEADER_LENGTH = 5;
const MAX_BODY_LENGTH = 0x7fff_fffb;
const CSTRING_TERMINATOR_DATA = new Uint8Array(1);
const CSTRING_TERMINATOR = 0;

function assertWrittenLength(output: Uint8Array, offset: number): Uint8Array {
  if (offset !== output.byteLength) throw new Error("PostgreSQL message length mismatch");
  return output;
}

function createFrameHeader(code: FRONTEND_MSG_CODE, bodyLength: number): Uint8Array {
  if (!Number.isSafeInteger(bodyLength) || bodyLength < 0 || bodyLength > MAX_BODY_LENGTH) {
    throw new RangeError("PostgreSQL message is too large");
  }
  const output = new Uint8Array(FRAME_HEADER_LENGTH);
  output[0] = code;
  new DataView(output.buffer).setInt32(1, bodyLength + 4);
  return output;
}

function encodePasswordMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.Password }>,
): Uint8Array[] {
  if ("password" in message) {
    const password = encodeCString(message.password);
    return [createFrameHeader(message.type, password.byteLength + 1), password, CSTRING_TERMINATOR_DATA];
  }
  if ("mechanism" in message) {
    const mechanism = encodeCString(message.mechanism);
    const bodyLength = mechanism.byteLength + 5 + (message.data?.byteLength ?? 0);
    const dataLength = new Uint8Array(4);
    writeUint32(dataLength, 0, message.data?.byteLength ?? -1);
    const output = [createFrameHeader(message.type, bodyLength), mechanism, CSTRING_TERMINATOR_DATA, dataLength];
    if (message.data) output.push(message.data);
    return output;
  }
  return [createFrameHeader(message.type, message.data.byteLength), message.data];
}
export interface SimpleQueryEncoder {
  calculateByteLength(): number;
  encodeQueryInto(data: Uint8Array, offset: number): number;
}
export function encodeQueryMessage(data: SimpleQueryEncoder): Uint8Array[] {
  const byteLength = data.calculateByteLength();
  const buffer = new Uint8Array(byteLength + 5);
  const offset = data.encodeQueryInto(buffer, 5);
  assertWrittenLength(buffer, offset);
  buffer[0] = FRONTEND_MSG_CODE.Query;
  writeUint32(buffer, 1, byteLength + 4);
  return [buffer];
}

export interface ParseStatementEncoder {
  calculateParseByteLength(): number;
  encodeParseInto(data: Uint8Array, offset: number): number;
}
export function calcParseMessageByteLength(statement: Pick<ParseStatementEncoder, "calculateParseByteLength">): number {
  return 5 + statement.calculateParseByteLength();
}
export function encodeParseMessageInto(
  buffer: Uint8Array,
  offset: number,
  statement: Pick<ParseStatementEncoder, "encodeParseInto">,
  messageByteLength: number,
): number {
  buffer[offset++] = FRONTEND_MSG_CODE.Parse;
  offset = writeUint32(buffer, offset, messageByteLength);
  return statement.encodeParseInto(buffer, offset);
}
export function encodeParseMessage(statement: ParseStatementEncoder): Uint8Array {
  const byteLength = calcParseMessageByteLength(statement);
  const buffer = new Uint8Array(byteLength);
  encodeParseMessageInto(buffer, 0, statement, byteLength - 1);
  return buffer;
}

export interface BindStatementEncoder {
  calculateBindByteLength(): number;
  encodeBindInto(data: Uint8Array, offset: number): number;
}
export function encodeBindMessage(data: BindStatementEncoder): Uint8Array {
  const byteLength = data.calculateBindByteLength();
  const buffer = new Uint8Array(byteLength + 5);
  buffer[0] = FRONTEND_MSG_CODE.Bind;
  writeUint32(buffer, 1, byteLength + 4);
  const offset = data.encodeBindInto(buffer, 5);
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
  const byteLength = name ? name.byteLength + 2 : 2;
  const buffer = new Uint8Array(byteLength + 5);
  buffer[0] = FRONTEND_MSG_CODE.Describe;
  writeUint32(buffer, 1, byteLength);
  buffer[5] = target;

  let offset = 6;
  if (name) {
    buffer.set(name, offset);
    offset += name.byteLength;
  }
  buffer[offset++] = CSTRING_TERMINATOR;
  return buffer;
}
export function encodeExecuteMessage(maxRows: number, portal?: Uint8Array): Uint8Array {
  const buffer = new Uint8Array(portal ? portal.byteLength + 9 : 9);
  buffer[0] = FRONTEND_MSG_CODE.Execute;
  writeUint32(buffer, 1, buffer.byteLength - 1);
  let offset = 5;
  if (portal) {
    buffer.set(portal, offset);
    offset += portal.byteLength;
  }
  buffer[offset++] = CSTRING_TERMINATOR;
  offset = writeUint32(buffer, offset, maxRows);
  assertWrittenLength(buffer, offset);
  return buffer;
}

export function encodeCloseMessage(target: DescribeTarget, name?: Uint8Array): Uint8Array {
  const byteLength = name ? name.byteLength + 2 : 2;
  const buffer = new Uint8Array(byteLength + 5);
  buffer[0] = FRONTEND_MSG_CODE.Close;
  writeUint32(buffer, 1, byteLength);
  buffer[5] = target;

  let offset = 6;
  if (name) {
    buffer.set(name, offset);
    offset += name.byteLength;
  }
  buffer[offset++] = CSTRING_TERMINATOR;
  return buffer;
}

function encodeCopyDataMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.CopyData }>,
): Uint8Array[] {
  return [createFrameHeader(message.type, message.data.byteLength), message.data];
}

function encodeCopyFailMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.CopyFail }>,
): Uint8Array[] {
  const reason = encodeCString(message.reason);
  return [createFrameHeader(message.type, reason.byteLength + 1), reason, CSTRING_TERMINATOR_DATA];
}

export function encodeFrontendMessage(message: PgFrontendMessage): Uint8Array[] {
  throw new Error("Unsupported frontend message type: " + message.type);
}
