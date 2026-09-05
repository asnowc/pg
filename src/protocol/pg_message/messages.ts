import type { AUTH_CODE, BACKEND_MSG_CODE, FRONTEND_MSG_CODE, PgFormat, PgTransactionStatus } from "./const.ts";
/**
 * PostgreSQL 消息类型定义。
 * 包含客户端发送给服务端的消息类型（PgFrontendMessage）以及服务端发送给客户端的消息类型（PgBackendMessage）。
 * @see https://www.postgresql.org/docs/current/protocol-message-formats.html
 */

/** 原始字段值；null 表示 SQL NULL。 */
export type PgValue = Uint8Array | null;
/** PostgreSQL 对象标识符。 */
export type PgOid = number;

/**
 * 客户端发送给服务端的普通消息。启动阶段特殊包不包含在内。
 */
export type PgFrontendMessage =
  | {
    type: FRONTEND_MSG_CODE.password;
    /** 明文密码。 */
    password: string;
  }
  | {
    type: FRONTEND_MSG_CODE.password;
    /** 已编码的密码或认证响应。 */
    data: Uint8Array;
  }
  | {
    type: FRONTEND_MSG_CODE.password;
    /** SASL 认证机制名称。 */
    mechanism: string;
    /** SASL 初始响应；null 表示没有初始响应。 */
    data: Uint8Array | null;
  }
  | {
    type: FRONTEND_MSG_CODE.query;
    /** 要执行的 SQL 文本。 */
    sql: string;
  }
  | {
    type: FRONTEND_MSG_CODE.parse;
    /** 客户端 prepared statement 名称；空字符串表示匿名语句。 */
    statement: string;
    /** 要解析和准备的 SQL 文本。 */
    sql: string;
    /** SQL 参数对应的 PostgreSQL 类型 OID。 */
    parameterTypeOids: readonly PgOid[];
  }
  | {
    type: FRONTEND_MSG_CODE.bind;
    /** 新建 portal 的名称；空字符串表示匿名 portal。 */
    portal: string;
    /** 要绑定的 prepared statement 名称；空字符串表示匿名语句。 */
    statement: string;
    /** 按参数顺序排列的实际参数值。 */
    parameters: readonly PgValue[];
    /** 参数使用的传输格式，0 为文本，1 为二进制。需要与 parameters 一一对应。 */
    parameterFormats: readonly PgFormat[];
    /** 结果列使用的传输格式，0 为文本，1 为二进制。 */
    resultFormats: readonly PgFormat[];
  }
  | {
    type: FRONTEND_MSG_CODE.describe;
    /** 要描述的是 prepared statement 还是 portal。 */
    target: "statement" | "portal";
    /** 要描述的对象名称；空字符串表示匿名对象。 */
    name: string;
  }
  | {
    type: FRONTEND_MSG_CODE.execute;
    /** 要执行的 portal 名称；空字符串表示匿名 portal。 */
    portal: string;
    /** 最多返回的行数，0 表示不限制。 */
    maxRows: number;
  }
  | {
    type: FRONTEND_MSG_CODE.close;
    /** 要关闭的是 prepared statement 还是 portal。 */
    target: "statement" | "portal";
    /** 要关闭的对象名称；空字符串表示匿名对象。 */
    name: string;
  }
  | { type: FRONTEND_MSG_CODE.flush }
  | { type: FRONTEND_MSG_CODE.sync }
  | {
    type: FRONTEND_MSG_CODE.copyData;
    /** COPY 数据块。 */
    data: Uint8Array;
  }
  | { type: FRONTEND_MSG_CODE.copyDone }
  | {
    type: FRONTEND_MSG_CODE.copyFail;
    /** COPY 失败原因。 */
    reason: string;
  }
  | { type: FRONTEND_MSG_CODE.terminate };

/** 后端消息公共字段。 */
interface PgBackendMessageBase<T extends BACKEND_MSG_CODE> {
  type: T;
  /** 消息体长度，不包含类型字节和长度字段。 */
  byteLength: number;
}

export interface PgFieldDescription {
  name: string;
  tableOid: PgOid;
  columnAttribute: number;
  dataTypeOid: PgOid;
  dataTypeSize: number;
  typeModifier: number;
  format: PgFormat;
}

export interface PgErrorFields {
  severity: string;
  severityNonLocalized?: string;
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}

export interface PgCopyResponse {
  overallFormat: PgFormat;
  columnFormats: readonly PgFormat[];
}

// PostgreSQL 已废弃 MD5 认证，本库仅支持明文密码和 SASL 认证消息。
export type PgAuthenticationMessage =
  | (PgBackendMessageBase<BACKEND_MSG_CODE.authentication> & {
    code: AUTH_CODE.OK | AUTH_CODE.GSS | AUTH_CODE.SSPI | AUTH_CODE.CLEARTEXT_PWD;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.authentication> & {
    code: AUTH_CODE.SASL;
    /** 服务端支持的 SASL 机制名称。 */
    mechanisms: readonly string[];
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.authentication> & {
    code: AUTH_CODE.SASL_FINAL | AUTH_CODE.SASL_CONTINUE | AUTH_CODE.GSS_CONTINUE | number;
    /** 服务端提供给客户端的认证挑战或附加数据。 */
    data: Uint8Array;
  });

/**
 *  已解析的后端消息。字段值仍保持原始字节。
 */
export type PgBackendMessage =
  | PgAuthenticationMessage
  | (PgBackendMessageBase<BACKEND_MSG_CODE.noData>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.notice> & {
    /** 通知的标准诊断字段。 */
    fields: PgErrorFields;
    /** 未映射的协议字段，键为 PostgreSQL 字段代码。 */
    info: Readonly<Record<string, string>>;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.error> & {
    /** 错误的标准诊断字段。 */
    fields: PgErrorFields;
    /** 未映射的协议字段，键为 PostgreSQL 字段代码。 */
    info: Readonly<Record<string, string>>;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.notification> & {
    /** 发送通知的后端进程 ID。 */
    processId: number;
    /** 通知所在的监听频道。 */
    channel: string;
    /** 通知携带的应用层负载。 */
    payload: string;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.parameterStatus> & {
    /** 发生变化的运行时参数名称。 */
    name: string;
    /** 运行时参数的新值。 */
    value: string;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.backendKeyData> & {
    /** 后端进程 ID，用于构造 CancelRequest。 */
    processId: number;
    /** 后端取消请求密钥，不是用户认证凭据。 */
    secretKey: number;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.bindComplete>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.closeComplete>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.commandComplete> & {
    /** SQL 命令完成标签，例如 SELECT 1 或 INSERT 0 1。 */
    tag: string;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.copyData> & {
    /** COPY 操作传输的数据块。 */
    data: Uint8Array;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.copyDone>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.copyInResponse> & PgCopyResponse)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.copyOutResponse> & PgCopyResponse)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.copyBothResponse> & PgCopyResponse)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.dataRow> & {
    /** 按 RowDescription 字段顺序排列的列值；null 表示 SQL NULL。 */
    values: readonly PgValue[];
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.emptyQuery>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.negotiateProtocolVersion> & {
    /** 服务端支持的最新协议次版本号。 */
    newestMinorVersion: number;
    /** 服务端不支持的客户端协议选项名称。 */
    unsupportedOptions: readonly string[];
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.parameterDescription> & {
    /** Parse 得到的参数类型 OID，顺序与 SQL 参数位置一致。 */
    dataTypeOids: readonly PgOid[];
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.parseComplete>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.portalSuspended>)
  | (PgBackendMessageBase<BACKEND_MSG_CODE.readyForQuery> & {
    /** 当前事务状态：空闲、事务中或事务失败。 */
    status: PgTransactionStatus | number;
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.rowDescription> & {
    /** 结果集列的名称、类型、格式等元数据。 */
    fields: readonly PgFieldDescription[];
  })
  | (PgBackendMessageBase<BACKEND_MSG_CODE.unknown> & {
    /** 未识别的后端消息类型字节。 */
    code: number;
    /** 未识别消息的原始消息体。 */
    data: Uint8Array;
  });

export type PgAsyncMessage = Extract<
  PgBackendMessage,
  {
    type:
      | BACKEND_MSG_CODE.notice
      | BACKEND_MSG_CODE.notification
      | BACKEND_MSG_CODE.parameterStatus;
  }
>;
