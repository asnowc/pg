import type { PgAsyncMessage } from "@/interface/protocol.ts";
import type { ByteStream } from "./ByteStream.ts";

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
    context: { mechanisms: readonly string[]; user: string; password?: string },
  ) => PgSaslExchange | Promise<PgSaslExchange>;
  onAsyncMessage?: (message: PgAsyncMessage) => void | Promise<void>;
}

type PgTlsMode = "disable" | "prefer" | "require";
/** @public */
export interface PgTlsOptions {
  mode: PgTlsMode;
  /** 平台负责 TLS 握手，并返回升级后的同一逻辑连接。 */
  upgrade(stream: ByteStream): ByteStream | Promise<ByteStream>;
}
/** @public */
export interface PgConnectOptions extends PgAuthenticationExchangeOptions {
  database: string;
  /** 配置后先执行 SSL 协商；未配置时直接使用传入的字节流。 */
  tls?: PgTlsOptions;
  /** 消息帧最大长度限制。 */
  maxMessageSize?: number;
}
