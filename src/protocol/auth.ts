import type { PgAsyncMessage, PgBackendMessage, PgTransactionStatus } from "./pg_message.ts";
import type { ByteStream } from "./ByteStream.ts";
import type { PgMessageReader } from "./PgMessageReader.ts";
/** SCRAM 认证所需的平台密码学能力；本库不实现已废弃的 MD5 认证。 */
export interface PgCryptoProvider {
  randomBytes(length: number): Uint8Array;
  digest(algorithm: "SHA-256", data: Uint8Array): Promise<Uint8Array>;
  hmac(algorithm: "SHA-256", key: Uint8Array, data: Uint8Array): Promise<Uint8Array>;
  pbkdf2(
    algorithm: "SHA-256",
    password: Uint8Array,
    salt: Uint8Array,
    iterations: number,
    length: number,
  ): Promise<Uint8Array>;
}

export interface PgSaslExchange {
  readonly mechanism: string;
  initialResponse(): Uint8Array | null | Promise<Uint8Array | null>;
  continue(challenge: Uint8Array): Uint8Array | Promise<Uint8Array>;
  final?(data: Uint8Array): void | Promise<void>;
}
export interface PgAuthenticationExchangeOptions {
  user: string;
  password?: string | (() => string | Promise<string>);

  /** 覆盖或扩展内置 SCRAM-SHA-256 认证，例如 OAUTHBEARER。 */
  createSaslExchange?: (
    mechanisms: readonly string[],
    context: { user: string; password?: string },
  ) => PgSaslExchange | Promise<PgSaslExchange>;
  onAsyncMessage?: (message: PgAsyncMessage) => void | Promise<void>;
}
/** StartupMessage 的参数。user 是协议要求的唯一必填参数。 */
export interface PgStartupOptions {
  user: string;
  database?: string;
  applicationName?: string;
  // client_encoding?: string;
  options?: string;
  replication?: false | true | "database";
  /** 额外运行时参数；不能覆盖 user、database、options、replication。 */
  parameters?: Readonly<Record<string, string>>;
}
type PgTlsMode = "disable" | "prefer" | "require";
export interface PgTlsOptions {
  mode: PgTlsMode;
  /** 平台负责 TLS 握手，并返回升级后的同一逻辑连接。 */
  upgrade(stream: ByteStream): ByteStream | Promise<ByteStream>;
}
/** 发送 SSLRequest，并在服务端接受时调用注入的 TLS 升级函数。 */
export declare function negotiateTls(stream: ByteStream, options: PgTlsOptions): Promise<ByteStream>;

/** 仅发送 StartupMessage。 */
export declare function startup(stream: ByteStream, options: PgStartupOptions): Promise<void>;

/** 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。 */
export declare function auth(stream: PgMessageReader, options: PgAuthenticationExchangeOptions): Promise<PgSessionInfo>;

/** 从认证阶段消息构造认证响应，供自定义连接状态机使用。 */
export declare function respondAuthentication(
  stream: PgMessageReader,
  message: PgBackendMessage,
  options: PgAuthenticationExchangeOptions,
  state?: PgSaslExchange,
): Promise<PgSaslExchange | undefined>;

export interface PgSessionInfo {
  protocolVersion: number;
  parameters: Readonly<Record<string, string>>;
  backendKey?: PgBackendKeyData;
  transactionStatus: PgTransactionStatus;
}
export interface PgBackendKeyData {
  processId: number;
  /** 协议 3.0 使用的 32 位取消请求密钥。 */
  secretKey: number;
}
/** 客户端不支持服务端要求的认证机制。 */
export declare class PgAuthenticationError extends Error {
  readonly mechanism?: string;
  constructor(message: string, mechanism?: string, options?: ErrorOptions);
}
