import { PgAuthenticationError } from "@/error.ts";
import type { PgAuthenticationExchangeOptions, PgSaslExchange } from "@/interface/Connection.ts";
import { decodeBase64, decodeUTF16String, encodeBase64 } from "@/_utils/string.ts";
import { AuthCode, BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { decodeBackendKeyData, decodeError, decodeNegotiateProtocolVersion, type PgBackendKeyData } from "./decode.ts";
import { encodePasswordMessage } from "./encode.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import {
  type BufferReader,
  type BufferWriter,
  type ByteBuffer,
  type ByteChunkParser,
  FixedBufferReader,
} from "@/_utils/DataBuffer.ts";
import { PgMessageFullParser } from "@/protocol/MessageParser.ts";

/**
 * 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。
 */
export async function startAuthentication(
  byteBuffer: ByteBuffer,
  options: PgAuthenticationExchangeOptions,
): Promise<AuthenticationResult> {
  const state = new AuthenticationState(byteBuffer, options);
  return new Promise<AuthenticationResult>((resolve, reject) => {
    byteBuffer.startRead((): boolean => {
      let result: AuthenticationResult | undefined;
      try {
        result = state.next(byteBuffer);
      } catch (err) {
        reject(err);
        return false;
      }

      if (result) {
        if (result.promise) result.promise.then(() => resolve(result), reject);
        else resolve(result);
      }
      return !!result;
    });
  });
}

type AuthenticationData = true | Promise<void>;
export type AuthenticationResult = {
  backendKey?: PgBackendKeyData;
  newestMinorVersion: number;
  unsupportedOptions: string[];
  promise?: Promise<void>;
};
export class AuthenticationState implements ByteChunkParser<AuthenticationResult> {
  constructor(private writer: BufferWriter, private options: PgAuthenticationExchangeOptions) {
  }

  private message?: PgMessageFullParser;
  next(reader: BufferReader): AuthenticationResult | undefined {
    this.message ??= new PgMessageFullParser(reader.readUInt8());
    const body = this.message.next(reader);
    if (body) {
      const result = this.onMessage(this.message.type, body);
      if (!result) return;
      return { ...this.getResult(), promise: result instanceof Promise ? result : undefined };
    }
  }
  private getResult() {
    return {
      backendKey: this.backendKey,
      newestMinorVersion: this.negotiateProtocolVersion?.newestMinorVersion ?? 0,
      unsupportedOptions: this.negotiateProtocolVersion?.unsupportedOptions ?? [],
    };
  }
  private backendKey?: PgBackendKeyData;
  private negotiateProtocolVersion?: {
    newestMinorVersion: number;
    unsupportedOptions: string[];
  };
  private authOk?: AuthenticationData;
  private onMessage(type: number, body: Uint8Array): AuthenticationData | undefined {
    switch (type) {
      case BackendMessageCode.Authentication: {
        this.onAuthMessage(new FixedBufferReader(body));
        break;
      }
      case BackendMessageCode.BackendKeyData: {
        this.backendKey = decodeBackendKeyData(body);
        break;
      }
      case BackendMessageCode.Error: {
        const message = decodeError(body);
        throw new PgAuthenticationError(message.fields.message, { cause: message });
      }
      case BackendMessageCode.NegotiateProtocolVersion: {
        this.negotiateProtocolVersion = decodeNegotiateProtocolVersion(body);
        break;
      }
      case BackendMessageCode.ReadyForQuery: {
        const statusCode = body[0];
        if (statusCode !== PgTransactionStatus.Idle) {
          throw new PgProtocolError("Unexpected transaction status: " + statusCode);
        }

        return this.authOk ?? true;
      }
      default:
        break;
    }
  }

  private auth?: AuthParser<AuthenticationData>;
  private authWaitOk?: AuthenticationData;

  /**
   * 传给 onAuth 的 reader，必须是一个完整的认证消息缓冲区
   */
  private onAuthMessage(reader: FixedBufferReader): AuthenticationData | undefined {
    const code = reader.readUInt32BE();
    if (code === AuthCode.OK) return this.authWaitOk ?? true;
    this.auth ??= getAuthParser(code, this.writer, this.options);
    if (this.authWaitOk) {
      throw new PgAuthenticationError("Unexpected authentication message after " + this.auth.authCode + " message");
    }
    const result = this.auth.next(reader);
    if (result instanceof Promise) {
      result.catch(() => {}); // 避免 Unhandled Promise Rejection
    }
    return result;
  }
}

function getAuthParser(
  code: number,
  writer: BufferWriter,
  options: PgAuthenticationExchangeOptions,
): AuthParser<AuthenticationData> {
  switch (code) {
    case AuthCode.CLEARTEXT_PWD:
      return new AuthCleartextPasswordParser(writer, options);
    case AuthCode.SASL:
      return new AuthSASLParser(writer, options);
    case AuthCode.MD5_PWD:
      throw createUnsupportedAuthenticationMethod("MD5_PWD");
    case AuthCode.GSS:
      throw createUnsupportedAuthenticationMethod("GSS");
    case AuthCode.SSPI:
      throw createUnsupportedAuthenticationMethod("SSPI");
    default:
      throw new Error(`Unsupported PostgreSQL authentication code: ${code}`); //TODO: 优化不支持的认证方式提示
  }
}
interface AuthParser<T> extends ByteChunkParser<T> {
  authCode: string;
}

class AuthSASLParser implements AuthParser<Promise<void> | true> {
  constructor(
    private writer: BufferWriter,
    private options: PgAuthenticationExchangeOptions,
  ) {
  }
  authCode = "SASL";
  f1?: {
    mechanisms: string[];
    exchange?: PgSaslExchange;
  };
  next(reader: BufferReader): Promise<void> | true | undefined {
    if (!this.f1) {
      this.f1 = this.start(reader);
      return;
    }
    const state = this.f1.exchange;
    const code = reader.readUInt32BE();
    switch (code) {
      case AuthCode.SASL_CONTINUE: {
        this.authCode = "SASL_CONTINUE";
        const data = reader.readBinary(reader.readerLength);
        if (!state) throw new PgAuthenticationError("Unexpected SASL continuation");
        this.writer.writeWith(async () => encodePasswordMessage({ data: await state.continue(data) }));
        return;
      }
      case AuthCode.SASL_FINAL: {
        const data = reader.readBinary(reader.readerLength);
        if (!state) throw new PgAuthenticationError("Unexpected SASL final message");
        return state.final?.(data) ?? true;
      }
      default:
        throw new PgAuthenticationError(`Unexpected SASL authentication code: ${code}`);
    }
  }
  start(reader: BufferReader): NonNullable<typeof this.f1> {
    const mechanisms = decodeSASLMechanisms(reader.readBinary(reader.readerLength), 0);
    if (!mechanisms) {
      throw new PgProtocolError("Invalid AuthenticationSASL message: missing terminator");
    }

    this.writer.writeWith(async () => {
      const options = this.options;
      const password = typeof options.password === "function" ? await options.password() : options.password;
      const createExchange = options.createSaslExchange ?? createScramExchange;
      const exchange = await createExchange({ mechanisms, user: options.user, password });
      const data = await exchange.initialResponse();
      this.f1!.exchange = exchange;
      return encodePasswordMessage({ mechanism: exchange.mechanism, data });
    });
    return { mechanisms };
  }
}
class AuthCleartextPasswordParser implements AuthParser<true> {
  constructor(private writer: BufferWriter, private options: PgAuthenticationExchangeOptions) {
  }
  authCode = "CLEAR_TEXT";
  next(reader: BufferReader): true | undefined {
    this.writer.writeWith(async () => {
      let password = this.options.password;
      if (typeof password === "function") password = await password();
      if (password === undefined) {
        throw new PgAuthenticationError("PostgreSQL requested a password, but none was provided");
      }
      return encodePasswordMessage({ password });
    });
    return true;
  }
}

function createUnsupportedAuthenticationMethod(method: string) {
  throw new Error(`Unsupported PostgreSQL authentication method: ${method}`);
}
function decodeSASLMechanisms(body: Uint8Array, offset: number): string[] | undefined {
  const mechanisms: string[] = [];
  while (offset < body.byteLength) {
    const end = body.indexOf(0, offset);
    if (end === offset) return mechanisms;
    if (end === -1) throw new PgAuthenticationError("Invalid SASL mechanisms format");
    const mechanism = decodeUTF16String(body.subarray(offset, end));
    offset = end + 1;
    mechanisms.push(mechanism);
  }
  return undefined;
}

async function createScramExchange(
  context: { mechanisms: readonly string[]; user: string; password?: string },
): Promise<PgSaslExchange> {
  const { mechanisms, user, password } = context;
  if (!mechanisms.includes("SCRAM-SHA-256")) {
    throw new PgAuthenticationError("SCRAM-SHA-256 is not supported by server");
  }
  if (password === undefined) {
    throw new PgAuthenticationError("SCRAM-SHA-256 requires a password", { mechanism: "SCRAM-SHA-256" });
  }
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
        throw new PgAuthenticationError("Invalid SCRAM server-first message", { mechanism: "SCRAM-SHA-256" });
      }
      const iterations = Number(attributes.i);
      if (!Number.isSafeInteger(iterations) || iterations <= 0) {
        throw new PgAuthenticationError("Invalid SCRAM iteration count", { mechanism: "SCRAM-SHA-256" });
      }
      const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
      const saltedPassword = new Uint8Array(
        await crypto.subtle.deriveBits(
          {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: decodeBase64(attributes.s),
            iterations,
          },
          key,
          256,
        ),
      );
      const clientKey = await hmac(saltedPassword, encoder.encode("Client Key"));
      const storedKey = new Uint8Array(await crypto.subtle.digest("SHA-256", clientKey));
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
      if (finalMessage.startsWith("e=")) {
        throw new PgAuthenticationError(finalMessage.slice(2), { mechanism: "SCRAM-SHA-256" });
      }
      if (!serverSignature || finalMessage !== `v=${serverSignature}`) {
        throw new PgAuthenticationError("SCRAM server signature verification failed", { mechanism: "SCRAM-SHA-256" });
      }
    },
  };
}

async function hmac(
  keyBytes: Uint8Array<ArrayBuffer>,
  data: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}
