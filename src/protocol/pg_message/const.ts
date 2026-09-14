/** PostgreSQL 7.4 及以上版本支持的协议版本 3.0。 */
export const PROTOCOL_VERSION = 0x0003_0000;
export const CANCEL_REQUEST_CODE = 80877102;
export const PG_EPOCH_UNIX_MS = 946684800000;
export const SSL_REQUEST_CODE = 80877103;
export const GSS_ENC_REQUEST_CODE = 80877104;

/** 后端消息类型字节。 */
export enum BACKEND_MSG_CODE {
  /** 无法识别的后端消息类型。 */
  unknown = -1,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NOTIFICATIONRESPONSE */
  notification = 0x41,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BINDCOMPLETE */
  bindComplete = 0x32,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSECOMPLETE */
  closeComplete = 0x33,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COMMANDCOMPLETE */
  commandComplete = 0x43,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDATA */
  copyData = 0x64,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-IN-RESPONSE */
  copyInResponse = 0x47,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-OUT-RESPONSE */
  copyOutResponse = 0x48,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-BOTH-RESPONSE */
  copyBothResponse = 0x57,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDONE */
  copyDone = 0x63,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DATAROW */
  dataRow = 0x44,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EMPTYQUERYRESPONSE */
  emptyQuery = 0x49,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE */
  error = 0x45,
  /** @deprecated 已废弃 */
  functionCallResponse = 0x56,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NEGOTIATEPROTOCOLVERSION */
  negotiateProtocolVersion = 0x76,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NOTICERESPONSE */
  notice = 0x4e,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERDESCRIPTION */
  parameterDescription = 0x74,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERSTATUS */
  parameterStatus = 0x53,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NODATA */
  noData = 0x6e,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSECOMPLETE */
  parseComplete = 0x31,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PORTALSUSPENDED */
  portalSuspended = 0x73,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-READYFORQUERY */
  readyForQuery = 0x5a,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ROWDESCRIPTION */
  rowDescription = 0x54,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATION */
  authentication = 0x52,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BACKENDKEYDATA */
  backendKeyData = 0x4b,
}

/** 前端消息类型字节。 */
/** @see https://www.postgresql.org/docs/current/protocol-message-formats.html */
export enum FRONTEND_MSG_CODE {
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND */
  bind = 0x42,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSE */
  close = 0x43,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDATA */
  copyData = 0x64,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDONE */
  copyDone = 0x63,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYFAIL */
  copyFail = 0x66,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DESCRIBE */
  describe = 0x44,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EXECUTE */
  execute = 0x45,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FLUSH */
  flush = 0x48,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE */
  parse = 0x50,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PASSWORDMESSAGE */
  password = 0x70,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY */
  query = 0x51,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-SYNC */
  sync = 0x53,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-TERMINATE */
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
