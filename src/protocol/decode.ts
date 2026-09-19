import { BackendMessageCode, NOTICE_STANDARD_FIELD_MAP, PgFormat, PgTransactionStatus } from "./const.ts";
import type { PgErrorFields, PgFieldDescription } from "./messages.ts";
import { decodeUTF16String, findCStringTerminator } from "@/_utils/string.ts";
import { decodeInt16BE, decodeInt32BE, decodeUInt16BE, decodeUInt32BE } from "@/_utils/number.ts";
import { PgProtocolError } from "@/_utils/error.ts";

// 启动消息

export function decodeNegotiateProtocolVersion(data: Uint8Array) {
  let offset = 0;
  const newestMinorVersion = decodeInt32BE(data, offset);
  offset += 4;
  const count = decodeUInt32BE(data, offset);
  offset += 4;

  const unsupportedOptions: string[] = new Array(count);
  for (let index = 0; index < count; index++) {
    const end = data.indexOf(0, offset);
    if (end === -1) break;
    unsupportedOptions[index] = decodeUTF16String(data.subarray(offset, end));
    offset = end + 1;
  }
  return { newestMinorVersion, unsupportedOptions };
}
export interface PgBackendKeyData {
  processId: number;
  /** 协议 3.0 使用的 32 位取消请求密钥。 */
  secretKey: number;
}
export function decodeBackendKeyData(body: Uint8Array): PgBackendKeyData {
  const byteLength = body.byteLength;
  if (byteLength !== 8) {
    throw new Error("Only protocol 3.0 BackendKeyData messages are supported");
  }
  const processId = decodeInt32BE(body, 0);
  const secretKey = decodeUInt32BE(body, 4);
  return {
    /** 后端进程 ID，用于构造 CancelRequest。 */
    processId,
    /** 后端取消请求密钥，不是用户认证凭据。 */
    secretKey,
  };
}
/*
application_name    scram_iterations
client_encoding     search_path
DateStyle           server_encoding
default_transaction_read_only	server_version
in_hot_standby      session_authorization
integer_datetimes   standard_conforming_strings
IntervalStyle       TimeZone
is_superuser

*/
export function decodeParameterStatus(body: Uint8Array) {
  let next = findCStringTerminator(body, 0);
  const name = decodeUTF16String(body.subarray(0, next));
  const offset = next + 1;
  next = findCStringTerminator(body, offset);
  const value = decodeUTF16String(body.subarray(offset, next));
  return { name, value };
}

// 数据

export function decodeDataRow(data: Uint8Array) {
  const count = decodeUInt16BE(data, 0);
  let offset = 2;
  const values: (Uint8Array | null)[] = new Array(count);
  let length: number;
  for (let index = 0; index < count; index++) {
    length = decodeInt32BE(data, offset);
    offset += 4;
    if (length === -1) {
      values[index] = null;
      continue;
    } else if (length < 0) throw new Error("invalid value length");
    values[index] = data.subarray(offset, offset + length);
    offset += length;
  }
  return values;
}
export function decodeParameterDescription(data: Uint8Array) {
  const count = decodeUInt16BE(data, 0);
  let offset = 2;
  const dataTypeOids: number[] = new Array(count);
  for (let index = 0; index < count; index++) {
    dataTypeOids[index] = decodeUInt32BE(data, offset);
    offset += 4;
  }
  return dataTypeOids;
}
export function decodeRowDescription(data: Uint8Array): PgFieldDescription[] {
  const count = decodeUInt16BE(data, 0);
  let offset = 2;
  const fields: PgFieldDescription[] = new Array(count);
  for (let index = 0; index < count; index++) {
    const item: Partial<PgFieldDescription> = {};
    const nameEnd = findCStringTerminator(data, offset);
    item.name = decodeUTF16String(data.subarray(offset, nameEnd));
    offset = nameEnd + 1;
    item.tableOid = decodeUInt32BE(data, offset);
    offset += 4;
    item.columnAttribute = decodeInt16BE(data, offset);
    offset += 2;
    item.dataTypeOid = decodeUInt32BE(data, offset);
    offset += 4;
    item.dataTypeSize = decodeInt16BE(data, offset);
    offset += 2;
    item.typeModifier = decodeInt32BE(data, offset);
    offset += 4;
    item.format = getFormat(decodeInt16BE(data, offset));
    offset += 2;
    fields[index] = item as PgFieldDescription;
  }
  return fields;
}

// 状态

export function decodeCommandComplete(data: Uint8Array) {
  return decodeUTF16String(data);
}

export function decodeReadyForQuery(body: Uint8Array): PgTransactionStatus {
  const statusCode = body[0];
  if (
    statusCode !== PgTransactionStatus.Idle && statusCode !== PgTransactionStatus.Transaction &&
    statusCode !== PgTransactionStatus.Failed
  ) {
    throw new PgProtocolError(`Invalid ReadyForQuery transaction status: ${statusCode}`);
  }
  return statusCode;
}

export function decodeCopyResponse(
  data: Uint8Array,
  code:
    | BackendMessageCode.CopyInResponse
    | BackendMessageCode.CopyOutResponse
    | BackendMessageCode.CopyBothResponse,
) {
  const overallFormat = data[0];
  if (overallFormat !== PgFormat.text && overallFormat !== PgFormat.binary) {
    throw new PgProtocolError(`Invalid PostgreSQL COPY format code: ${overallFormat}`);
  }
  let offset = 1;
  const count = decodeUInt16BE(data, offset);
  offset += 2;
  const columnFormats: PgFormat[] = new Array(count);
  for (let index = 0; index < count; index++) {
    columnFormats[index] = getFormat(decodeInt16BE(data, offset));
    offset += 2;
  }
  return { overallFormat, columnFormats };
}

// 通知

export function decodeNotification(body: Uint8Array) {
  let offset = 0;
  const processId = decodeInt32BE(body, 0);
  offset += 4;
  let next = findCStringTerminator(body, offset);
  const channel = decodeUTF16String(body.subarray(offset, next));
  offset = next + 1;
  next = findCStringTerminator(body, offset);
  const payload = decodeUTF16String(body.subarray(offset, next));
  offset = next + 1;
  return { processId, channel, payload };
}

export function decodeError(body: Uint8Array) {
  return decodeNoticeResponse(body);
}
export function decodeNotice(body: Uint8Array) {
  return decodeNoticeResponse(body);
}
function decodeNoticeResponse(body: Uint8Array) {
  const fields: Record<string, string> = {};
  const unknown: Record<string, string> = {};
  const total = body.byteLength;
  let offset: number = 0;
  let fieldCode: number;
  while (offset < total) {
    fieldCode = body[offset++];
    if (fieldCode === 0) break;
    const next = findCStringTerminator(body, offset);
    const value = decodeUTF16String(body.subarray(offset, next));
    offset = next + 1;

    const key = String.fromCharCode(fieldCode);
    const name = NOTICE_STANDARD_FIELD_MAP[key];
    if (name) fields[name] = value;
    else unknown[key] = value;
  }

  if (fields.severity === undefined || fields.code === undefined || fields.message === undefined) {
    throw new PgProtocolError("Invalid PostgreSQL notice response: missing required field");
  }
  return { fields: fields as unknown as PgErrorFields, info: unknown };
}

function getFormat(format: number): PgFormat {
  if (format !== PgFormat.text && format !== PgFormat.binary) {
    throw new PgProtocolError(`Invalid PostgreSQL format code: ${format}`);
  }
  return format;
}
