import { FRONTEND_MSG_CODE } from "./const.ts";
import type { PgFrontendMessage } from "./messages.ts";
import { assertInt32, assertUint16, assertUint32, encodeCString, writeUint16, writeUint32 } from "@/_utils/data_type_bin.ts";
import { COPY_DONE, FLUSH, SYNC, TERMINATE } from "./_static_frame.ts";

const FRAME_HEADER_LENGTH = 5;
const MAX_BODY_LENGTH = 0x7fff_fffb;
const CSTRING_TERMINATOR = new Uint8Array(1);

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

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PASSWORDMESSAGE
 */
function encodePasswordMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.password }>,
): Uint8Array[] {
  if ("password" in message) {
    const password = encodeCString(message.password);
    return [createFrameHeader(message.type, password.byteLength + 1), password, CSTRING_TERMINATOR];
  }
  if ("mechanism" in message) {
    const mechanism = encodeCString(message.mechanism);
    const bodyLength = mechanism.byteLength + 5 + (message.data?.byteLength ?? 0);
    const dataLength = new Uint8Array(4);
    writeUint32(dataLength, 0, message.data?.byteLength ?? -1);
    const output = [createFrameHeader(message.type, bodyLength), mechanism, CSTRING_TERMINATOR, dataLength];
    if (message.data) output.push(message.data);
    return output;
  }
  return [createFrameHeader(message.type, message.data.byteLength), message.data];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY
 */
function encodeQueryMsg(message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.query }>): Uint8Array[] {
  const sql = encodeCString(message.sql);
  return [createFrameHeader(message.type, sql.byteLength + 1), sql, CSTRING_TERMINATOR];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
 */
function encodeParseMsg(message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.parse }>): Uint8Array[] {
  const statement = encodeCString(message.statement);
  const sql = encodeCString(message.sql);
  assertUint16(message.parameterTypeOids.length, "Parameter type count");
  for (const oid of message.parameterTypeOids) assertUint32(oid, "Parameter type OID");
  const bodyLength = statement.byteLength + sql.byteLength + 4 + message.parameterTypeOids.length * 4;
  const parameterTypes = new Uint8Array(2 + message.parameterTypeOids.length * 4);
  let offset = writeUint16(parameterTypes, 0, message.parameterTypeOids.length);
  for (const oid of message.parameterTypeOids) offset = writeUint32(parameterTypes, offset, oid);
  assertWrittenLength(parameterTypes, offset);
  return [
    createFrameHeader(message.type, bodyLength),
    statement,
    CSTRING_TERMINATOR,
    sql,
    CSTRING_TERMINATOR,
    parameterTypes,
  ];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND
 */
function encodeBindMsg(message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.bind }>): Uint8Array[] {
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
    CSTRING_TERMINATOR,
    statement,
    CSTRING_TERMINATOR,
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

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DESCRIBE
 */
function encodeDescribeMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.describe }>,
): Uint8Array[] {
  const name = encodeCString(message.name);
  return [
    createFrameHeader(message.type, name.byteLength + 2),
    Uint8Array.of(message.target === "statement" ? 0x53 : 0x50),
    name,
    CSTRING_TERMINATOR,
  ];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EXECUTE
 */
function encodeExecuteMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.execute }>,
): Uint8Array[] {
  const portal = encodeCString(message.portal);
  assertInt32(message.maxRows, "maxRows");
  const maxRows = new Uint8Array(4);
  writeUint32(maxRows, 0, message.maxRows);
  return [createFrameHeader(message.type, portal.byteLength + 5), portal, CSTRING_TERMINATOR, maxRows];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSE
 */
function encodeCloseMsg(message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.close }>): Uint8Array[] {
  const name = encodeCString(message.name);
  return [
    createFrameHeader(message.type, name.byteLength + 2),
    Uint8Array.of(message.target === "statement" ? 0x53 : 0x50),
    name,
    CSTRING_TERMINATOR,
  ];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDATA
 */
function encodeCopyDataMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.copyData }>,
): Uint8Array[] {
  return [createFrameHeader(message.type, message.data.byteLength), message.data];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYFAIL
 */
function encodeCopyFailMsg(
  message: Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.copyFail }>,
): Uint8Array[] {
  const reason = encodeCString(message.reason);
  return [createFrameHeader(message.type, reason.byteLength + 1), reason, CSTRING_TERMINATOR];
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html
 */
export function encodeFrontendMessage(message: PgFrontendMessage): Uint8Array[] {
  switch (message.type) {
    case FRONTEND_MSG_CODE.password:
      return encodePasswordMsg(message);
    case FRONTEND_MSG_CODE.query:
      return encodeQueryMsg(message);
    case FRONTEND_MSG_CODE.parse:
      return encodeParseMsg(message);
    case FRONTEND_MSG_CODE.bind:
      return encodeBindMsg(message);
    case FRONTEND_MSG_CODE.describe:
      return encodeDescribeMsg(message);
    case FRONTEND_MSG_CODE.execute:
      return encodeExecuteMsg(message);
    case FRONTEND_MSG_CODE.close:
      return encodeCloseMsg(message);
    case FRONTEND_MSG_CODE.flush:
      return [FLUSH];
    case FRONTEND_MSG_CODE.sync:
      return [SYNC];
    case FRONTEND_MSG_CODE.copyData:
      return encodeCopyDataMsg(message);
    case FRONTEND_MSG_CODE.copyDone:
      return [COPY_DONE];
    case FRONTEND_MSG_CODE.copyFail:
      return encodeCopyFailMsg(message);
    case FRONTEND_MSG_CODE.terminate:
      return [TERMINATE];
  }
}
