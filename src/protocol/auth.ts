import type { PgAuthenticationExchangeOptions } from "@/interface/Connection.ts";
import { AuthCode, BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { decodeBackendKeyData, decodeError, decodeNegotiateProtocolVersion, type PgBackendKeyData } from "./decode.ts";
import { PgProtocolError, UnexpectedEOFError } from "@/_utils/error.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { AuthenticationData, AuthParser, getAuthParser } from "./parsers/AuthParser.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { PgAuthenticationError } from "@/error.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/**
 * 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。
 */
export async function startAuthentication(
  conn: ConnectionStream,
  options: PgAuthenticationExchangeOptions,
): Promise<AuthenticationResult> {
  const parser = new MessageParsers(DEFAULT_MAX_MESSAGE_SIZE);
  let backendKey: PgBackendKeyData | undefined;
  let negotiateProtocolVersion: { newestMinorVersion: number; unsupportedOptions: string[] } | undefined;

  parser.set(BackendMessageCode.BackendKeyData, (data) => {
    backendKey = decodeBackendKeyData(data);
  });
  parser.set(BackendMessageCode.NegotiateProtocolVersion, (data) => {
    negotiateProtocolVersion = decodeNegotiateProtocolVersion(data);
  });

  let auth: AuthParser<AuthenticationData> | undefined;
  let authOk: AuthenticationData | undefined;
  parser.set(BackendMessageCode.Authentication, (data) => {
    const reader = new BufferReader(data, data.byteLength);
    const code = reader.readUInt32BE();
    if (code === AuthCode.OK) return;
    auth ??= getAuthParser(code, conn, options);
    const result = auth.next(reader, code);
    if (result instanceof Promise) {
      result.catch(() => {}); // 避免 Unhandled Promise Rejection
    }
    authOk = result;
  });

  await new Promise<void>((resolve, reject) => {
    let isDone = false;
    conn.listenOnError(reject);
    conn.startReadLoop(() => {
      parser.next(conn);
      return isDone;
    }, () => reject(new UnexpectedEOFError()));
    parser.set(BackendMessageCode.ErrorResponse, (data) => {
      const errorMessage = decodeError(data);
      throw new PgAuthenticationError(errorMessage.fields.message);
    });
    parser.set(BackendMessageCode.ReadyForQuery, (data) => {
      const statusCode = data[0];
      if (statusCode !== PgTransactionStatus.Idle) {
        throw new PgProtocolError("Unexpected transaction status: " + statusCode);
      }
      isDone = true;
      conn.listenOnError(undefined);
      resolve();
    });
  });
  await authOk;
  return {
    backendKey,
    newestMinorVersion: negotiateProtocolVersion?.newestMinorVersion ?? 0,
    unsupportedOptions: negotiateProtocolVersion?.unsupportedOptions ?? [],
  };
}

export type AuthenticationResult = {
  backendKey?: PgBackendKeyData;
  newestMinorVersion: number;
  unsupportedOptions: string[];
  promise?: Promise<void>;
};
