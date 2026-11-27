import type { PgAuthenticationExchangeOptions } from "@/interface/Connection.ts";
import { AuthCode, BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { decodeBackendKeyData, decodeError, decodeNegotiateProtocolVersion, type PgBackendKeyData } from "./decode.ts";
import { PgProtocolError, UnexpectedEOFError } from "@/internal/error.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import type { DataStream } from "@/internal/DataStream.ts";
import { AuthenticationData, AuthParser, getAuthParser } from "./parsers/AuthParser.ts";
import { ReadBuffer } from "@/internal/ReadBuffer.ts";
import { PgAuthenticationError } from "@/error.ts";
import { BufferWriterQueue } from "@/internal/BufferWriterQueue.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

/**
 * 执行密码/SASL 认证并读取到首个 ReadyForQuery。调用前必须已发送 StartupMessage。
 */
export async function startAuthentication(
  conn: DataStream,
  options: PgAuthenticationExchangeOptions,
): Promise<AuthenticationResult> {
  const parser = new MessageParsers(DEFAULT_MAX_MESSAGE_SIZE);
  let backendKey: PgBackendKeyData | undefined;
  let negotiateProtocolVersion: { newestMinorVersion: number; unsupportedOptions: string[] } | undefined;

  parser.setFullParser(BackendMessageCode.BackendKeyData, (data) => {
    backendKey = decodeBackendKeyData(data, new DataView(data.buffer, data.byteOffset, data.byteLength));
  });
  parser.setFullParser(BackendMessageCode.NegotiateProtocolVersion, (data) => {
    negotiateProtocolVersion = decodeNegotiateProtocolVersion(
      data,
      new DataView(data.buffer, data.byteOffset, data.byteLength),
    );
  });

  let auth: AuthParser<AuthenticationData> | undefined;
  let authOk: AuthenticationData | undefined;

  await new Promise<void>((resolve, reject) => {
    const writer = new BufferWriterQueue(conn, () => conn.closeWrite(), reject);
    parser.setFullParser(BackendMessageCode.Authentication, (data) => {
      const reader = new ReadBuffer(data, data.byteLength);
      const code = reader.view.getUint32(reader.readableStart);
      reader.readableStart += 4;
      if (code === AuthCode.OK) return;
      auth ??= getAuthParser(code, writer, options);
      const result = auth.next(reader, code);
      if (result instanceof Promise) {
        result.catch(() => {}); // 避免 Unhandled Promise Rejection
      }
      authOk = result;
    });
    let isDone = false;
    conn.listenOnError(reject);
    parser.setFullParser(BackendMessageCode.ErrorResponse, (data) => {
      const errorMessage = decodeError(data);
      throw new PgAuthenticationError(errorMessage.fields.message);
    });
    parser.setFullParser(BackendMessageCode.ReadyForQuery, (data) => {
      const statusCode = data[0];
      if (statusCode !== PgTransactionStatus.Idle) {
        throw new PgProtocolError("Unexpected transaction status: " + statusCode);
      }
      isDone = true;
      conn.listenOnError(undefined);
      resolve();
    });
    conn.startReadLoop(
      (buffer) => {
        parser.next(buffer);
        return isDone;
      },
      () => reject(new UnexpectedEOFError()),
    );
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
