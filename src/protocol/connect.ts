import type { ByteStream } from "@/interface/ByteStream.ts";
import type { PgConnectOptions, PgTlsOptions } from "@/interface/Connection.ts";
import { PROTOCOL_VERSION, TLSResponseCode } from "./const.ts";
import { PgAuthenticationError } from "@/error.ts";
import { encodeNegotiateTlsMessage, encodeStartupMessage } from "./encode.ts";
import { startAuthentication } from "./auth.ts";
import { readLength } from "@/_utils/ByteStream.ts";
import { PgSession } from "@/protocol.ts";

export async function connectFromByteStream(
  byteStream: ByteStream,
  options: PgConnectOptions,
): Promise<PgSession> {
  const { tls, maxMessageSize, user, database } = options;
  let stream = byteStream;
  try {
    if (tls && tls.mode !== "disable") stream = await negotiateTls(stream, tls);
    const startupMessage = encodeStartupMessage(
      PROTOCOL_VERSION,
      getStartupParameters({ user, database }),
    );
    const [sessionInfo] = await Promise.all([
      startAuthentication(stream, options),
      stream.write(startupMessage),
    ]);
    return new PgSession(stream, sessionInfo, maxMessageSize);
  } catch (error) {
    stream.close();
    throw error;
  }
}

/**
 * 发送 SSLRequest，并在服务端接受时调用注入的 TLS 升级函数。
 */
async function negotiateTls(stream: ByteStream, options: PgTlsOptions): Promise<ByteStream> {
  await stream.write(encodeNegotiateTlsMessage());
  const responseData = await readLength(stream, 1);
  const responseCode = responseData[0];
  if (responseCode === TLSResponseCode.Accepted) return await options.upgrade(stream);
  if (responseCode === TLSResponseCode.Rejected && options.mode === "prefer") return stream;
  if (responseCode === TLSResponseCode.Rejected) throw new PgAuthenticationError("PostgreSQL server refused TLS");
  throw new PgAuthenticationError(`Invalid PostgreSQL SSL response: 0x${responseCode.toString(16)}`);
}
/**
 * StartupMessage 的参数。user 是协议要求的唯一必填参数。
 */
export interface PgStartupOptions {
  user: string;
  database?: string;
  applicationName?: string;
  options?: string;
  replication?: false | true | "database";
}
function getStartupParameters(options: PgStartupOptions): Map<string, string> {
  const parameters = new Map<string, string>();
  parameters.set("user", options.user);
  parameters.set("client_encoding", "UTF8");
  if (options.database) parameters.set("database", options.database);
  if (options.applicationName) parameters.set("application_name", options.applicationName);
  if (options.options) parameters.set("options", options.options);
  if (options.replication) parameters.set("replication", options.replication === true ? "true" : options.replication);
  return parameters;
}
