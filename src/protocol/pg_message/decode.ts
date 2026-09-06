import { PgProtocolError } from "./errors.ts";
import { AUTH_CODE, BACKEND_MSG_CODE, PgFormat, PgTransactionStatus } from "./const.ts";
import type { PgAuthenticationMessage, PgBackendMessage, PgErrorFields, PgFieldDescription } from "./messages.ts";
import { ByteReader } from "./_data_type_bin.ts";

export function assertHasBeenFullyRead(reader: ByteReader, messageCode: number): void {
  if (reader.remaining !== 0) {
    throw new PgProtocolError(
      `Invalid PostgreSQL message 0x${messageCode.toString(16)}: ${reader.remaining} trailing message bytes`,
      { messageCode },
    );
  }
}

function readFormat(reader: ByteReader): PgFormat {
  const format = reader.readInt16();
  if (format !== PgFormat.text && format !== PgFormat.binary) {
    throw new PgProtocolError(`Invalid PostgreSQL format code: ${format}`, { messageCode: format });
  }
  return format;
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATION
 */
export function decodeAuthentication(reader: ByteReader): PgAuthenticationMessage {
  const type = BACKEND_MSG_CODE.authentication;
  const byteLength = reader.byteLength;
  const authenticationCode = reader.readInt32();
  if ([AUTH_CODE.OK, AUTH_CODE.GSS, AUTH_CODE.SSPI, AUTH_CODE.CLEARTEXT_PWD].includes(authenticationCode)) {
    assertHasBeenFullyRead(reader, type);
    return { type, byteLength, code: authenticationCode };
  }
  if (authenticationCode === AUTH_CODE.SASL) {
    const mechanisms: string[] = [];
    while (reader.remaining > 0) {
      const mechanism = reader.readCString();
      if (mechanism === "") {
        assertHasBeenFullyRead(reader, type);
        return { type, byteLength, code: authenticationCode, mechanisms };
      }
      mechanisms.push(mechanism);
    }
    throw new PgProtocolError("Invalid AuthenticationSASL message: missing terminator", {
      messageCode: BACKEND_MSG_CODE.authentication,
    });
  } else if (authenticationCode === AUTH_CODE.MD5_PWD) {
    // PostgreSQL 已废弃 MD5 认证，本库不提供兼容实现。
    throw new PgProtocolError("MD5 authentication is not supported", { messageCode: type });
  }

  return { type, byteLength, code: authenticationCode, data: reader.readBytes() };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BACKENDKEYDATA
 */
export function decodeBackendKeyData(reader: ByteReader): PgBackendMessage {
  const type = BACKEND_MSG_CODE.backendKeyData;
  const byteLength = reader.byteLength;
  if (byteLength !== 8) {
    throw new PgProtocolError("Only protocol 3.0 BackendKeyData messages are supported", {
      messageCode: BACKEND_MSG_CODE.backendKeyData,
    });
  }
  const processId = reader.readInt32();
  const secretKey = reader.readUint32();
  assertHasBeenFullyRead(reader, type);
  return { type, byteLength, processId, secretKey };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COMMANDCOMPLETE
 */
export function decodeCommandComplete(reader: ByteReader): PgBackendMessage {
  const type = BACKEND_MSG_CODE.commandComplete;
  const tag = reader.readCString();
  assertHasBeenFullyRead(reader, type);
  return { type, byteLength: reader.byteLength, tag };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-IN-RESPONSE
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-OUT-RESPONSE
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-BOTH-RESPONSE
 */
export function decodeCopyResponse(
  reader: ByteReader,
  code:
    | BACKEND_MSG_CODE.copyInResponse
    | BACKEND_MSG_CODE.copyOutResponse
    | BACKEND_MSG_CODE.copyBothResponse,
): PgBackendMessage {
  const overallFormat = reader.readInt8();
  if (overallFormat !== PgFormat.text && overallFormat !== PgFormat.binary) {
    throw new PgProtocolError(`Invalid PostgreSQL COPY format code: ${overallFormat}`, { messageCode: code });
  }
  const count = reader.readUint16();
  const columnFormats: PgFormat[] = new Array(count);
  for (let index = 0; index < count; index++) columnFormats[index] = readFormat(reader);
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, overallFormat, columnFormats };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DATAROW
 */
export function decodeDataRow(reader: ByteReader): PgBackendMessage {
  const code = BACKEND_MSG_CODE.dataRow;
  const count = reader.readUint16();
  const values: (Uint8Array | null)[] = new Array(count);
  for (let index = 0; index < count; index++) values[index] = reader.readValue();
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, values };
}
const ERROR_KEY_MAP: Record<string, string> = {
  S: "severity",
  V: "severityNonLocalized",
  C: "code",
  M: "message",
  D: "detail",
  H: "hint",
  P: "position",
  p: "internalPosition",
  q: "internalQuery",
  W: "where",
  s: "schema",
  t: "table",
  c: "column",
  d: "dataType",
  n: "constraint",
  F: "file",
  L: "line",
  R: "routine",
};

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NOTICERESPONSE
 */
export function decodeNoticeResponse(
  reader: ByteReader,
  code: BACKEND_MSG_CODE.error | BACKEND_MSG_CODE.notice,
): Extract<
  PgBackendMessage,
  { type: BACKEND_MSG_CODE.error | BACKEND_MSG_CODE.notice }
> {
  const fields: Record<string, string> = {};
  const unknown: Record<string, string> = {};

  while (reader.remaining > 0) {
    const fieldCode = reader.readInt8();
    if (fieldCode === 0) {
      break;
    }
    const value = reader.readCString();
    const key = String.fromCharCode(fieldCode);
    const name = ERROR_KEY_MAP[key];
    if (name) fields[name] = value;
    else unknown[key] = value;
  }

  assertHasBeenFullyRead(reader, code);
  if (fields.severity === undefined || fields.code === undefined || fields.message === undefined) {
    throw new PgProtocolError("Invalid PostgreSQL error response: missing required field", { messageCode: code });
  }
  if (code === BACKEND_MSG_CODE.error) {
    return {
      type: code,
      byteLength: reader.byteLength,
      fields: fields as unknown as PgErrorFields,
      info: unknown,
    };
  } else {
    return {
      type: code,
      byteLength: reader.byteLength,
      fields: fields as unknown as PgErrorFields,
      info: unknown,
    };
  }
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NEGOTIATEPROTOCOLVERSION
 */
export function decodeNegotiateProtocolVersion(
  reader: ByteReader,
): PgBackendMessage {
  const code = BACKEND_MSG_CODE.negotiateProtocolVersion;
  const newestMinorVersion = reader.readInt32();
  const count = reader.readInt32();
  if (count < 0) {
    throw new PgProtocolError("Invalid NegotiateProtocolVersion option count", {
      messageCode: BACKEND_MSG_CODE.negotiateProtocolVersion,
    });
  }
  const unsupportedOptions: string[] = new Array(count);
  for (let index = 0; index < count; index++) unsupportedOptions[index] = reader.readCString();
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, newestMinorVersion, unsupportedOptions };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NOTIFICATIONRESPONSE
 */
export function decodeNotification(reader: ByteReader): PgBackendMessage {
  const code = BACKEND_MSG_CODE.notification;
  const processId = reader.readInt32();
  const channel = reader.readCString();
  const payload = reader.readCString();
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, processId, channel, payload };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERDESCRIPTION
 */
export function decodeParameterDescription(
  reader: ByteReader,
): PgBackendMessage {
  const code = BACKEND_MSG_CODE.parameterDescription;
  const count = reader.readUint16();
  const dataTypeOids: number[] = new Array(count);
  for (let index = 0; index < count; index++) dataTypeOids[index] = reader.readUint32();
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, dataTypeOids };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERSTATUS
 */
export function decodeParameterStatus(reader: ByteReader): PgBackendMessage {
  const code = BACKEND_MSG_CODE.parameterStatus;
  const name = reader.readCString();
  const value = reader.readCString();
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, name, value };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-READYFORQUERY
 */
export function decodeReadyForQuery(reader: ByteReader): PgBackendMessage {
  const code = BACKEND_MSG_CODE.readyForQuery;
  const statusCode = reader.readInt8();
  if (
    statusCode !== PgTransactionStatus.Idle && statusCode !== PgTransactionStatus.Transaction &&
    statusCode !== PgTransactionStatus.Failed
  ) {
    throw new PgProtocolError(`Invalid ReadyForQuery transaction status: ${statusCode}`, {
      messageCode: BACKEND_MSG_CODE.readyForQuery,
    });
  }
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, status: statusCode };
}

/**
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ROWDESCRIPTION
 */
export function decodeRowDescription(reader: ByteReader): PgBackendMessage {
  const code = BACKEND_MSG_CODE.rowDescription;
  const count = reader.readUint16();
  const fields: PgFieldDescription[] = new Array(count);
  for (let index = 0; index < count; index++) {
    fields[index] = {
      name: reader.readCString(),
      tableOid: reader.readUint32(),
      columnAttribute: reader.readInt16(),
      dataTypeOid: reader.readUint32(),
      dataTypeSize: reader.readInt16(),
      typeModifier: reader.readInt32(),
      format: readFormat(reader),
    };
  }
  assertHasBeenFullyRead(reader, code);
  return { type: code, byteLength: reader.byteLength, fields };
}
export function decodeBackendMessage(code: number, body: Uint8Array): PgBackendMessage {
  const reader = new ByteReader(body);
  switch (code) {
    case BACKEND_MSG_CODE.authentication:
      return decodeAuthentication(reader);
    case BACKEND_MSG_CODE.backendKeyData:
      return decodeBackendKeyData(reader);
    case BACKEND_MSG_CODE.bindComplete:
    case BACKEND_MSG_CODE.closeComplete:
    case BACKEND_MSG_CODE.copyDone:
    case BACKEND_MSG_CODE.emptyQuery:
    case BACKEND_MSG_CODE.noData:
    case BACKEND_MSG_CODE.parseComplete:
    case BACKEND_MSG_CODE.portalSuspended:
      assertHasBeenFullyRead(reader, code);
      return { type: code, byteLength: reader.byteLength };
    case BACKEND_MSG_CODE.commandComplete:
      return decodeCommandComplete(reader);
    case BACKEND_MSG_CODE.copyData:
      return { type: BACKEND_MSG_CODE.copyData, byteLength: reader.byteLength, data: reader.readBytes() };
    case BACKEND_MSG_CODE.copyInResponse:
    case BACKEND_MSG_CODE.copyOutResponse:
    case BACKEND_MSG_CODE.copyBothResponse:
      return decodeCopyResponse(reader, code);
    case BACKEND_MSG_CODE.dataRow:
      return decodeDataRow(reader);
    case BACKEND_MSG_CODE.error:
    case BACKEND_MSG_CODE.notice:
      return decodeNoticeResponse(reader, code);
    case BACKEND_MSG_CODE.negotiateProtocolVersion:
      return decodeNegotiateProtocolVersion(reader);
    case BACKEND_MSG_CODE.notification:
      return decodeNotification(reader);
    case BACKEND_MSG_CODE.parameterDescription:
      return decodeParameterDescription(reader);
    case BACKEND_MSG_CODE.parameterStatus:
      return decodeParameterStatus(reader);
    case BACKEND_MSG_CODE.readyForQuery:
      return decodeReadyForQuery(reader);
    case BACKEND_MSG_CODE.rowDescription:
      return decodeRowDescription(reader);
    default:
      return { type: BACKEND_MSG_CODE.unknown, byteLength: reader.byteLength, code, data: reader.readBytes() };
  }
}
