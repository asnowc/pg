import {
  AUTH_CODE,
  BACKEND_MSG_CODE,
  decodeBackendMessage,
  encodeFrontendMessage,
  FRONTEND_MSG_CODE,
  PROTOCOL_VERSION,
  SSL_REQUEST_CODE,
} from "./pg_message.ts";
import type { PgAsyncMessage, PgBackendMessage, PgTransactionStatus } from "./pg_message.ts";
import type { ByteStream } from "./ByteStream.ts";
import type { PgMessageReader } from "./PgMessageReader.ts";
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
/**
 * 发送 SSLRequest，并在服务端接受时调用注入的 TLS 升级函数。
 * @public
 */
export async function negotiateTls(stream: ByteStream, options: PgTlsOptions): Promise<ByteStream> {
  if (options.mode === "disable") return stream;
  const request = new Uint8Array(8);
  const view = new DataView(request.buffer);
  view.setInt32(0, 8);
  view.setInt32(4, SSL_REQUEST_CODE);
  try {
    await stream.write(request);
    const response = (await stream.read(1))[0];
    if (response === 0x53) return await options.upgrade(stream);
    if (response === 0x4e && options.mode === "prefer") return stream;
    if (response === 0x4e) throw new PgAuthenticationError("PostgreSQL server refused TLS");
    throw new PgAuthenticationError(`Invalid PostgreSQL SSL response: 0x${response.toString(16)}`);
  } catch (error) {
    stream.close();
    throw error;
  }
}

/**
 * 仅发送 StartupMessage。
 * @public
 */
export async function startup(stream: ByteStream, options: PgStartupOptions): Promise<void> {
  const parameters: Record<string, string> = {
    user: options.user,
    ...(options.database === undefined ? {} : { database: options.database }),
    ...(options.applicationName === undefined ? {} : { application_name: options.applicationName }),
    ...(options.options === undefined ? {} : { options: options.options }),
    ...(options.replication === undefined || options.replication === false
      ? {}
      : { replication: options.replication === true ? "true" : options.replication }),
  };
  const reserved = new Set(["user", "database", "application_name", "options", "replication"]);
  for (const [key, value] of Object.entries(options.parameters ?? {})) {
    if (reserved.has(key)) throw new TypeError(`Startup parameter '${key}' is reserved`);
    parameters[key] = value;
  }
  for (const [key, value] of Object.entries(parameters)) {
    if (!key || key.includes("\0") || value.includes("\0")) {
      throw new TypeError("Startup parameters cannot contain NUL");
    }
  }
  const encoder = new TextEncoder();
  const entries = Object.entries(parameters).flatMap(([key, value]) => [encoder.encode(key), encoder.encode(value)]);
  const length = 9 + entries.reduce((sum, entry) => sum + entry.byteLength + 1, 0);
  const message = new Uint8Array(length);
  const view = new DataView(message.buffer);
  view.setInt32(0, length);
  view.setInt32(4, PROTOCOL_VERSION);
  let offset = 8;
  for (const entry of entries) {
    message.set(entry, offset);
    offset += entry.byteLength + 1;
  }
  await stream.write(message);
}

/**
 * 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。
 * @public
 */
export async function auth(stream: PgMessageReader, options: PgAuthenticationExchangeOptions): Promise<PgSessionInfo> {
  const parameters: Record<string, string> = {};
  let backendKey: PgBackendKeyData | undefined;
  let sasl: PgSaslExchange | undefined;
  while (true) {
    const pending = await stream.read();
    if (!pending) throw new PgAuthenticationError("PostgreSQL closed the connection during authentication");
    const message = decodeBackendMessage(pending.type, await pending.readBody());
    if (message.type === BACKEND_MSG_CODE.authentication) {
      sasl = await respondAuthentication(stream, message, options, sasl);
    } else if (message.type === BACKEND_MSG_CODE.parameterStatus) {
      parameters[message.name] = message.value;
      await options.onAsyncMessage?.(message);
    } else if (message.type === BACKEND_MSG_CODE.backendKeyData) {
      backendKey = { processId: message.processId, secretKey: message.secretKey };
    } else if (message.type === BACKEND_MSG_CODE.readyForQuery) {
      return { protocolVersion: PROTOCOL_VERSION, parameters, backendKey, transactionStatus: message.status };
    } else if (message.type === BACKEND_MSG_CODE.error) {
      throw new PgAuthenticationError(message.fields.message, undefined, { cause: message });
    } else if (message.type === BACKEND_MSG_CODE.notice || message.type === BACKEND_MSG_CODE.notification) {
      await options.onAsyncMessage?.(message);
    }
  }
}

/**
 * 从认证阶段消息构造认证响应，供自定义连接状态机使用。
 * @public
 */
export async function respondAuthentication(
  stream: PgMessageReader,
  message: PgBackendMessage,
  options: PgAuthenticationExchangeOptions,
  state?: PgSaslExchange,
): Promise<PgSaslExchange | undefined> {
  if (message.type !== BACKEND_MSG_CODE.authentication) return state;
  if (message.code === AUTH_CODE.OK) return state;
  if (message.code === AUTH_CODE.CLEARTEXT_PWD) {
    const password = typeof options.password === "function" ? await options.password() : options.password;
    if (password === undefined) {
      throw new PgAuthenticationError("PostgreSQL requested a password, but none was provided");
    }
    await writeMessages(stream, { type: FRONTEND_MSG_CODE.password, password });
    return state;
  }
  if (message.code === AUTH_CODE.SASL && "mechanisms" in message) {
    const password = typeof options.password === "function" ? await options.password() : options.password;
    const exchange = options.createSaslExchange
      ? await options.createSaslExchange(message.mechanisms, { user: options.user, password })
      : await createScramExchange(message.mechanisms, options.user, password);
    await writeMessages(stream, {
      type: FRONTEND_MSG_CODE.password,
      mechanism: exchange.mechanism,
      data: await exchange.initialResponse(),
    });
    return exchange;
  }
  if (message.code === AUTH_CODE.SASL_CONTINUE) {
    if (!state || !("data" in message)) throw new PgAuthenticationError("Unexpected SASL continuation");
    await writeMessages(stream, { type: FRONTEND_MSG_CODE.password, data: await state.continue(message.data) });
    return state;
  }
  if (message.code === AUTH_CODE.SASL_FINAL) {
    if (!state || !("data" in message)) throw new PgAuthenticationError("Unexpected SASL final message");
    await state.final?.(message.data);
    return state;
  }
  throw new PgAuthenticationError(`Unsupported PostgreSQL authentication code: ${message.code}`, String(message.code));
}

/** @public */
export interface PgSessionInfo {
  protocolVersion: number;
  parameters: Readonly<Record<string, string>>;
  backendKey?: PgBackendKeyData;
  transactionStatus: PgTransactionStatus;
}
/** @public */
export interface PgBackendKeyData {
  processId: number;
  /** 协议 3.0 使用的 32 位取消请求密钥。 */
  secretKey: number;
}
/**
 * 客户端不支持服务端要求的认证机制。
 * @public
 */
export class PgAuthenticationError extends Error {
  readonly mechanism?: string;
  constructor(message: string, mechanism?: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PgAuthenticationError";
    this.mechanism = mechanism;
  }
}

async function writeMessages(
  stream: PgMessageReader,
  message: Parameters<typeof encodeFrontendMessage>[0],
): Promise<void> {
  for (const part of encodeFrontendMessage(message)) await stream.write(part);
}

async function createScramExchange(
  mechanisms: readonly string[],
  user: string,
  password?: string,
): Promise<PgSaslExchange> {
  if (!mechanisms.includes("SCRAM-SHA-256")) {
    throw new PgAuthenticationError("SCRAM-SHA-256 is not supported by server");
  }
  if (password === undefined) throw new PgAuthenticationError("SCRAM-SHA-256 requires a password", "SCRAM-SHA-256");
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = encodeBase64(nonceBytes);
  const escapedUser = user.replaceAll("=", "=3D").replaceAll(",", "=2C");
  const clientFirstBare = `n=${escapedUser},r=${nonce}`;
  let serverSignature: string | undefined;
  return {
    mechanism: "SCRAM-SHA-256",
    initialResponse: () => encoder.encode(`n,,${clientFirstBare}`),
    async continue(challenge) {
      const serverFirst = decoder.decode(challenge);
      const attributes = Object.fromEntries(serverFirst.split(",").map((item) => [item[0], item.slice(2)]));
      if (!attributes.r?.startsWith(nonce) || !attributes.s || !attributes.i) {
        throw new PgAuthenticationError("Invalid SCRAM server-first message", "SCRAM-SHA-256");
      }
      const iterations = Number(attributes.i);
      if (!Number.isSafeInteger(iterations) || iterations <= 0) {
        throw new PgAuthenticationError("Invalid SCRAM iteration count", "SCRAM-SHA-256");
      }
      const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
      const saltedPassword = new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: Uint8Array.from(decodeBase64(attributes.s)),
            iterations,
          },
          key,
          256,
        ),
      );
      const clientKey = await hmac(saltedPassword, encoder.encode("Client Key"));
      const storedKey = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(clientKey)));
      const clientFinalWithoutProof = `c=biws,r=${attributes.r}`;
      const authMessage = encoder.encode(`${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`);
      const clientSignature = await hmac(storedKey, authMessage);
      const proof = clientKey.map((value, index) => value ^ clientSignature[index]);
      const serverKey = await hmac(saltedPassword, encoder.encode("Server Key"));
      serverSignature = encodeBase64(await hmac(serverKey, authMessage));
      return encoder.encode(`${clientFinalWithoutProof},p=${encodeBase64(proof)}`);
    },
    final(data) {
      const finalMessage = decoder.decode(data);
      if (finalMessage.startsWith("e=")) throw new PgAuthenticationError(finalMessage.slice(2), "SCRAM-SHA-256");
      if (!serverSignature || finalMessage !== `v=${serverSignature}`) {
        throw new PgAuthenticationError("SCRAM server signature verification failed", "SCRAM-SHA-256");
      }
    },
  };
}

async function hmac(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(keyBytes),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, Uint8Array.from(data)));
}

function encodeBase64(data: Uint8Array): string {
  return btoa(String.fromCharCode(...data));
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
