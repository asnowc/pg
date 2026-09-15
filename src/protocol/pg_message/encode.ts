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
import { COPY_DONE, FLUSH, SYNC, TERMINATE } from "./_static_frame.ts";

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

function encodeQueryMsg(message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.Query }>): Uint8Array[] {
  const sql = encodeCString(message.sql);
  return [createFrameHeader(message.type, sql.byteLength + 1), sql, CSTRING_TERMINATOR_DATA];
}

export interface ParseStatementEncoder {
  calculateParseByteLength(): number;
  encodeParseInto(data: Uint8Array, offset: number): number;
}
export interface SimpleQueryEncoder {
  calculateByteLength(): number;
  encodeQueryInto(data: Uint8Array, offset: number): number;
}

export function encodeParseMessage(statement: ParseStatementEncoder): Uint8Array {
  const byteLength = 5 + statement.calculateParseByteLength();
  const buffer = new Uint8Array(byteLength);
  const offset = statement.encodeParseInto(buffer, 5);
  buffer[0] = FRONTEND_MSG_CODE.Parse;
  writeUint32(buffer, 1, byteLength + 4);
  assertWrittenLength(buffer, offset);
  // header
  return buffer;
}

function encodeBindMsg(message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.Bind }>): Uint8Array[] {
  assertUint16(message.parameterFormats.length, "Parameter format count");
  assertUint16(message.parameters.length, "Parameter count");
  assertUint16(message.resultFormats.length, "Result format count");
  for (const parameter of message.parameters) {
    if (parameter) assertInt32(parameter.byteLength, "Parameter byte length");
  }
  const portal = encodeCString(message.portal);
  const statement = encodeCString(message.statement);
  const valuesLength = message.parameters.reduce((sum, value) => sum + 4 + (value?.byteLength ?? 0), 0);
  const bodyLength = portal.byteLength + statement.byteLength + 8 + message.parameterFormats.length * 2 + valuesLength +
    message.resultFormats.length * 2;
  const metadataLength = 6 + message.parameterFormats.length * 2 + message.parameters.length * 4 +
    message.resultFormats.length * 2;
  const metadata = new Uint8Array(metadataLength);
  const output = [
    createFrameHeader(message.type, bodyLength),
    portal,
    CSTRING_TERMINATOR_DATA,
    statement,
    CSTRING_TERMINATOR_DATA,
  ];
  let offset = writeUint16(metadata, 0, message.parameterFormats.length);
  for (const format of message.parameterFormats) offset = writeUint16(metadata, offset, format);
  offset = writeUint16(metadata, offset, message.parameters.length);
  let metadataStart = 0;
  for (const parameter of message.parameters) {
    offset = writeUint32(metadata, offset, parameter?.byteLength ?? -1);
    if (parameter) {
      output.push(metadata.subarray(metadataStart, offset), parameter);
      metadataStart = offset;
    }
  }
  offset = writeUint16(metadata, offset, message.resultFormats.length);
  for (const format of message.resultFormats) offset = writeUint16(metadata, offset, format);
  assertWrittenLength(metadata, offset);
  output.push(metadata.subarray(metadataStart));
  return output;
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

/**
 * @param target 0x53: statement, 0x50: portal
 */
export function encodeDescribeMessage(target: 0x53 | 0x50, name?: Uint8Array) {
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

function encodeCloseMessage(target: 0x53 | 0x50, name?: Uint8Array): Uint8Array {
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
