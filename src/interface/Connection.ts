import type { PgAsyncMessage } from "@/interface/protocol.ts";
import type { Duplex } from "node:stream";

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
  createSaslExchange?: (context: CreateSaslExchangeContext) => PgSaslExchange | Promise<PgSaslExchange>;
  onAsyncMessage?: (message: PgAsyncMessage) => void;
}

/** @public */
export interface PgConnectOptions<T = ConnectionSource> extends PgAuthenticationExchangeOptions {
  database: string;
  /**
   * 配置连接的加密选项. 当前仅支持 TLS 加密。
   */
  encryption?:
    | ConnectionEncryptionOptions<T>
    | (() => ConnectionEncryptionOptions<T> | undefined | Promise<ConnectionEncryptionOptions<T> | undefined>);

  /** 消息帧最大长度限制。 */
  maxMessageSize?: number;
}
/** @public */
export type ConnectionEncryptionOptions<T> = TLSEncryptionOptions<T>;

/**
 * TLS 加密选项。
 * @public
 */
export type TLSEncryptionOptions<T> = {
  mode: "TLS";
  /** 平台负责 TLS 握手，并返回升级后的同一逻辑连接。 */
  upgradeTLS(connection: T): Promise<ConnectionSource>;
};

/** @public */
export type CreateSaslExchangeContext = { mechanisms: readonly string[]; user: string; password?: string };

/** @public */
export type PrunedDenoConn = {
  close: () => void;
  read: (p: Uint8Array) => Promise<number | null>;
  write: (p: Uint8Array) => Promise<number>;
  closeWrite: () => Promise<void>;
};

/** @public */
export type ConnectionSource = Duplex | PrunedDenoConn;
