import { PgAuthenticationError } from "@/error.ts";
import type { PgAuthenticationExchangeOptions, PgSaslExchange } from "@/interface/Connection.ts";
import { decodeBase64, decodeUTF16String, encodeBase64 } from "@/_utils/string.ts";
import { AuthCode, BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { decodeBackendKeyData, decodeError, decodeNegotiateProtocolVersion } from "./decode.ts";
import type { PgSession } from "./PgSession.ts";
import { encodePasswordMessage } from "./encode.ts";
import { decodeInt32BE } from "@/_utils/number.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { readLength } from "@/_utils/ByteStream.ts";

/**
 * 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。
 */
export async function startAuthentication(
  stream: PgSession,
  options: PgAuthenticationExchangeOptions,
): Promise<void> {
  let sasl: PgSaslExchange | undefined;
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  stream.subscribe({
    resolve,
    reject,
    async onMessage(reader, type, bodyLength) {
      const body = await readLength(reader, bodyLength);

      switch (type) {
        case BackendMessageCode.ReadyForQuery: {
          const statusCode = body[0];
          if (statusCode !== PgTransactionStatus.Idle) {
            throw new PgProtocolError("Unexpected transaction status: " + statusCode);
          }
          stream.removeSubscriber();
          break;
        }
        case BackendMessageCode.NegotiateProtocolVersion: {
          const { newestMinorVersion, unsupportedOptions } = decodeNegotiateProtocolVersion(body);
          // Handle NegotiateProtocolVersion message if needed
          break;
        }

        case BackendMessageCode.Authentication: {
          sasl = await respondAuthentication(stream, body, options, sasl);
          break;
        }

        case BackendMessageCode.BackendKeyData: {
          const backendKey = decodeBackendKeyData(body);
          stream.processId = backendKey.processId;
          stream.secretKey = backendKey.secretKey;
          break;
        }

        case BackendMessageCode.Error: {
          const message = decodeError(body);
          throw new PgAuthenticationError(message.fields.message, { cause: message });
        }

        default:
          break;
      }
    },
  });
  return promise;
}

/**
 * 从认证阶段消息构造认证响应，供自定义连接状态机使用。
 */
async function respondAuthentication(
  stream: PgSession,
  body: Uint8Array,
  options: PgAuthenticationExchangeOptions,
  state?: PgSaslExchange,
): Promise<PgSaslExchange | undefined> {
  const code = decodeInt32BE(body, 0);
  const offset = 4;
  switch (code) {
    case AuthCode.OK:
      return state;
    case AuthCode.CLEARTEXT_PWD: {
      const password = typeof options.password === "function" ? await options.password() : options.password;
      if (password === undefined) {
        throw new PgAuthenticationError("PostgreSQL requested a password, but none was provided");
      }
      await stream.write(encodePasswordMessage({ password }));
      return state;
    }
    case AuthCode.SASL: {
      const mechanisms = decodeSASLMechanisms(body, offset);
      if (!mechanisms) {
        throw new PgProtocolError("Invalid AuthenticationSASL message: missing terminator");
      }
      const password = typeof options.password === "function" ? await options.password() : options.password;
      const createExchange = options.createSaslExchange ?? createScramExchange;
      const exchange = await createExchange({ mechanisms, user: options.user, password });
      const data = await exchange.initialResponse();
      await stream.write(encodePasswordMessage({ mechanism: exchange.mechanism, data }));
      return exchange;
    }
    case AuthCode.SASL_CONTINUE: {
      const data = body.subarray(offset);
      if (!state || !data) throw new PgAuthenticationError("Unexpected SASL continuation");
      await stream.write(encodePasswordMessage({ data: await state.continue(data) }));
      return state;
    }
    case AuthCode.SASL_FINAL: {
      const data = body.subarray(offset);
      if (!state || !data) throw new PgAuthenticationError("Unexpected SASL final message");
      await state.final?.(data);
      return state;
    }
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
