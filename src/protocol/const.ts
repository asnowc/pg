/** PostgreSQL 7.4 及以上版本支持的协议版本 3.0。 */
export const PROTOCOL_VERSION = 0x0003_0000;
export const CANCEL_REQUEST_CODE = 80877102;
export const PG_EPOCH_UNIX_MS = 946684800000;
export const SSL_REQUEST_CODE = 80877103;
export const GSS_ENC_REQUEST_CODE = 80877104;

/** SSL 协商响应字节。 */
export enum TLSResponseCode {
  Accepted = 0x53,
  Rejected = 0x4e,
}

/** 后端消息类型字节。 */
export enum BackendMessageCode {
  /** 无法识别的后端消息类型。 */
  Unknown = -1,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NOTIFICATIONRESPONSE */
  NotificationResponse = 0x41,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BINDCOMPLETE */
  BindComplete = 0x32,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSECOMPLETE */
  CloseComplete = 0x33,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COMMANDCOMPLETE */
  CommandComplete = 0x43,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDATA */
  CopyData = 0x64,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-IN-RESPONSE */
  CopyInResponse = 0x47,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-OUT-RESPONSE */
  CopyOutResponse = 0x48,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPY-BOTH-RESPONSE */
  CopyBothResponse = 0x57,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDONE */
  CopyDone = 0x63,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DATAROW */
  DataRow = 0x44,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EMPTYQUERYRESPONSE */
  EmptyQueryResponse = 0x49,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ERRORRESPONSE */
  Error = 0x45,
  /** @deprecated 已废弃 */
  FunctionCallResponse = 0x56,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NEGOTIATEPROTOCOLVERSION */
  NegotiateProtocolVersion = 0x76,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NOTICERESPONSE */
  NoticeResponse = 0x4e,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERDESCRIPTION */
  ParameterDescription = 0x74,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARAMETERSTATUS */
  ParameterStatus = 0x53,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-NODATA */
  NoData = 0x6e,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSECOMPLETE */
  ParseComplete = 0x31,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PORTALSUSPENDED */
  PortalSuspended = 0x73,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-READYFORQUERY */
  ReadyForQuery = 0x5a,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-ROWDESCRIPTION */
  RowDescription = 0x54,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-AUTHENTICATION */
  Authentication = 0x52,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BACKENDKEYDATA */
  BackendKeyData = 0x4b,
}
/** 前端消息类型字节。 */
/** @see https://www.postgresql.org/docs/current/protocol-message-formats.html */
export enum FrontendMessageCode {
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-BIND */
  Bind = 0x42,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-CLOSE */
  Close = 0x43,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDATA */
  CopyData = 0x64,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYDONE */
  CopyDone = 0x63,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-COPYFAIL */
  CopyFail = 0x66,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-DESCRIBE */
  Describe = 0x44,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-EXECUTE */
  Execute = 0x45,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-FLUSH */
  Flush = 0x48,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE */
  Parse = 0x50,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PASSWORDMESSAGE */
  Password = 0x70,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-QUERY */
  Query = 0x51,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-SYNC */
  Sync = 0x53,
  /** @see https://www.postgresql.org/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-TERMINATE */
  Terminate = 0x58,
}
/** 文本或二进制字段格式。 */
export enum PgFormat {
  text = 0,
  binary = 1,
}

export enum AuthCode {
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
export const NOTICE_STANDARD_FIELD_MAP: Record<string, string> = {
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
