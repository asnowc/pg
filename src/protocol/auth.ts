import { PgAuthenticationError } from "@/error.ts";
import type { PgAuthenticationExchangeOptions } from "@/interface/Connection.ts";
import { AuthCode, BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { decodeBackendKeyData, decodeError, decodeNegotiateProtocolVersion, type PgBackendKeyData } from "./decode.ts";
import { PgProtocolError, UnexpectedEOFError } from "@/_utils/error.ts";
import { checkMessageLength, MessageFullParser } from "./MessageParser.ts";
import { BufferReader, StreamParser, StreamReader } from "@/_utils/StreamReader.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { StreamWriter } from "@/_utils/StreamWriter.ts";
import { AuthenticationData, AuthParser, getAuthParser } from "./AuthParser.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/**
 * 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。
 */
export async function startAuthentication(
  byteBuffer: ConnectionStream,
  options: PgAuthenticationExchangeOptions,
): Promise<AuthenticationResult> {
  const state = new AuthenticationState(byteBuffer, options);
  return new Promise<AuthenticationResult>((resolve, reject) => {
    byteBuffer.startReadLoop((): boolean => {
      let result: AuthenticationResult | undefined;
      try {
        result = state.next(byteBuffer);
      } catch (err) {
        reject(err);
        return true;
      }

      if (result) {
        if (result.promise) result.promise.then(() => resolve(result), reject);
        else resolve(result);
      }
      return !!result;
    }, () => reject(new UnexpectedEOFError()));
  });
}

export type AuthenticationResult = {
  backendKey?: PgBackendKeyData;
  newestMinorVersion: number;
  unsupportedOptions: string[];
  promise?: Promise<void>;
};

class AuthenticationState implements StreamParser<AuthenticationResult> {
  constructor(private writer: StreamWriter, private options: PgAuthenticationExchangeOptions) {
  }

  private message?: MessageFullParser;
  private type?: number;

  next(reader: StreamReader): AuthenticationResult | undefined {
    while (reader.readableLength > 0) {
      this.type ??= reader.readUInt8();
      if (!this.message) {
        if (reader.readableLength < 4) return;

        const messageLength = reader.readInt32BE();
        checkMessageLength(messageLength, DEFAULT_MAX_MESSAGE_SIZE);
        this.message = new MessageFullParser(messageLength - 4);
      }
      const message = this.message;
      const body = message.next(reader);
      if (body) {
        const type = this.type;
        this.message = undefined;
        this.type = undefined;
        const result = this.onMessageBody(type, body);
        if (result) return { ...this.getResult(), promise: result instanceof Promise ? result : undefined };
      }
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
  private onMessageBody(type: number, body: Uint8Array): AuthenticationData | undefined {
    switch (type) {
      case BackendMessageCode.Authentication: {
        this.onAuthMessage(new BufferReader(body, body.byteLength));
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
  private authOk?: AuthenticationData;

  /**
   * 传给 onAuth 的 reader，必须是一个完整的认证消息缓冲区
   */
  private onAuthMessage(reader: BufferReader): undefined {
    const code = reader.readUInt32BE();
    if (code === AuthCode.OK) {
      return;
    }
    this.auth ??= getAuthParser(code, this.writer, this.options);
    const result = this.auth.next(reader, code);
    if (result instanceof Promise) {
      result.catch(() => {}); // 避免 Unhandled Promise Rejection
    }
    this.authOk = result;
  }
}
