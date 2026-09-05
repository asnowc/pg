/** PostgreSQL 7.4 及以上版本支持的协议版本 3.0。 */
export const PROTOCOL_VERSION = 0x0003_0000;
export const CANCEL_REQUEST_CODE = 80877102;
export const PG_EPOCH_UNIX_MS = 946684800000;
export const SSL_REQUEST_CODE = 80877103;
export const GSS_ENC_REQUEST_CODE = 80877104;

/** 后端消息类型字节。 */
export enum BACKEND_MSG_CODE {
  unknown = -1,
  notification = 0x41,
  bindComplete = 0x32,
  closeComplete = 0x33,
  commandComplete = 0x43,
  copyData = 0x64,
  copyDone = 0x63,
  copyInResponse = 0x47,
  copyOutResponse = 0x48,
  copyBothResponse = 0x57,
  dataRow = 0x44,
  emptyQuery = 0x49,
  error = 0x45,
  /** @deprecated 已废弃 */
  functionCallResponse = 0x56,
  negotiateProtocolVersion = 0x76,
  noData = 0x6e,
  notice = 0x4e,
  parameterDescription = 0x74,
  parameterStatus = 0x53,
  parseComplete = 0x31,
  portalSuspended = 0x73,
  readyForQuery = 0x5a,
  rowDescription = 0x54,
  authentication = 0x52,
  backendKeyData = 0x4b,
}

/** 前端消息类型字节。 */
export enum FRONTEND_MSG_CODE {
  bind = 0x42,
  close = 0x43,
  copyData = 0x64,
  copyDone = 0x63,
  copyFail = 0x66,
  describe = 0x44,
  execute = 0x45,
  flush = 0x48,
  parse = 0x50,
  password = 0x70,
  query = 0x51,
  sync = 0x53,
  terminate = 0x58,
}
/** 文本或二进制字段格式。 */
export enum PgFormat {
  text = 0,
  binary = 1,
}

export enum AUTH_CODE {
  OK = 0,
  KERBEROS_V5 = 2, //??
  CLEARTEXT_PWD = 3,
  /** @deprecated 已废弃 */
  MD5_PWD = 5,
  GSS = 7,
  GSS_CONTINUE = 8,
  SSPI = 9,
  SASL = 10,
  SASL_CONTINUE = 11,
  SASL_FINAL = 12,
}
export enum PgTransactionStatus {
  Idle = 0x49,
  Transaction = 0x54,
  Failed = 0x45,
}
