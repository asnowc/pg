import type { PgAsyncMessage } from "@/interface/protocol.ts";
import type { ByteStream } from "./ByteStream.ts";

/**
 * SCRAM 认证所需的平台密码学能力；本库不实现已废弃的 MD5 认证。
 * @public
 */
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

/** @public */
export interface PgSaslExchange {
  readonly mechanism: string;
  initialResponse(): Uint8Array | null | Promise<Uint8Array | null>;
  continue(challenge: Uint8Array): Uint8Array | Promise<Uint8Array>;
  final?(data: Uint8Array): void | Promise<void>;
}
/** @public */
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
/**
 * StartupMessage 的参数。user 是协议要求的唯一必填参数。
 * @public
 */
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
/** @public */
export interface PgTlsOptions {
  mode: PgTlsMode;
  /** 平台负责 TLS 握手，并返回升级后的同一逻辑连接。 */
  upgrade(stream: ByteStream): ByteStream | Promise<ByteStream>;
}
