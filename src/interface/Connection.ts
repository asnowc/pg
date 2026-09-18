import type { PgAsyncMessage } from "./protocol.ts";
import type { Duplex } from "node:stream";
import {
  CopyQueryOperation,
  CursorQueryOperation,
  MultipleQueryOperation,
  PipelineQueryOperation,
  SingleQueryOperation,
  TransactionQueryOperation,
} from "./Query.ts";

/** @public */
export interface PgConnection
  extends
    PipelineQueryOperation,
    MultipleQueryOperation,
    CopyQueryOperation,
    SingleQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation,
    AsyncDisposable {
  readonly processId: number | null;
  readonly parameters: Record<string, string>;
  readonly closed: boolean;
  get finished(): Promise<void>;
  close(): Promise<void>;
  destroy(): void;
}

/** @public */
export interface PgPoolConnection
  extends
    PipelineQueryOperation,
    MultipleQueryOperation,
    CopyQueryOperation,
    SingleQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation,
    Disposable {
  get released(): boolean;
  readonly closed: boolean;
  readonly processId: number | null;
  /** 幂等释放。现有操作结束后才实际归还连接；此后不再接受新操作。 */
  release(): void;
  close(): Promise<void>;
  destroy(): void;
}

/** @public */
export type PgSaslExchange = {
  readonly mechanism: string;
  initialResponse(): Uint8Array | null | Promise<Uint8Array | null>;
  continue(challenge: Uint8Array): Uint8Array | Promise<Uint8Array>;
  final?(data: Uint8Array): void | Promise<void>;
};
/** @public */
export type PgAuthenticationExchangeOptions = {
  user: string;
  password?: string | (() => string | Promise<string>);

  /** 覆盖或扩展内置 SCRAM-SHA-256 认证，例如 OAUTHBEARER。 */
  createSaslExchange?: (context: CreateSaslExchangeContext) => PgSaslExchange | Promise<PgSaslExchange>;
  onAsyncMessage?: (message: PgAsyncMessage) => void;
};

/** @public */
export type CreateSaslExchangeContext = { mechanisms: readonly string[]; user: string; password?: string };

type PgConnectionBaseOptions = PgAuthenticationExchangeOptions & {
  database: string;
  /** 消息帧最大长度限制。 */
  maxMessageSize?: number;
};
/** @public */
export type PgConnectOptions<T = ConnectionSource> = PgConnectionBaseOptions & {
  /**
   * 配置连接的加密选项. 当前仅支持 TLS 加密。
   */
  encryption?: TLSEncryptionOptions<T>[];
};

/** @public */
export type PgNetConnectOptions = PgConnectionBaseOptions & {
  hostname: string;
  port: number;
  encryption?: NetTLSEncryptionOptions[];
};
/** @public */
export type NetTLSEncryptionOptions = {
  mode: "TLS";
  ca?: Array<string | Uint8Array>;
};

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
export type PrunedDenoConn = {
  close: () => void;
  read: (p: Uint8Array) => Promise<number | null>;
  write: (p: Uint8Array) => Promise<number>;
  closeWrite: () => Promise<void>;
};

/** @public */
export type ConnectionSource = Duplex | PrunedDenoConn;
