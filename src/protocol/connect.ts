import type { PgConnectOptions, TLSEncryptionOptions } from "@/interface/Connection.ts";
import { PROTOCOL_VERSION, TLSResponseCode } from "./const.ts";
import { PgAuthenticationError } from "@/error.ts";
import { encodeNegotiateTlsMessage, encodeStartupMessage } from "./encode.ts";
import { startAuthentication } from "./auth.ts";
import { readLength } from "@/_utils/ByteStream.ts";
import { PgSession } from "@/protocol.ts";
import type { ByteBuffer } from "@/_utils/DataBuffer.ts";

export async function connectFromByteStream(
  byteStream: ByteBuffer,
  options: PgConnectOptions<ByteBuffer>,
): Promise<PgSession> {
  const { encryption, maxMessageSize, user, database } = options;
  let stream: ByteBuffer = byteStream;
  if (encryption) {
    //TODO: 查询服务器支持的加密方式
    const encryptionOptions = typeof encryption === "function" ? await encryption() : encryption;
    if (encryptionOptions) {
      if (encryptionOptions.mode === "TLS") stream = await negotiateTls(stream, encryptionOptions);
      else {
        throw new PgAuthenticationError(`Unsupported encryption mode: ${encryptionOptions.mode}`);
      }
    }
  }
  try {
    const startupMessage = encodeStartupMessage(
      PROTOCOL_VERSION,
      getStartupParameters({ user, database }),
    );
    byteStream.write(startupMessage);
    const info = await startAuthentication(byteStream, options);
    return new PgSession(byteStream, { maxMessageSize });
  } catch (error) {
    byteStream.destroy();
    throw error;
  }
}

/**
 * 发送 SSLRequest，并在服务端接受时调用注入的 TLS 升级函数。
 */
async function negotiateTls(byteBuffer: ByteBuffer, options: TLSEncryptionOptions<ByteBuffer>): Promise<ByteBuffer> {
  await byteBuffer.write(encodeNegotiateTlsMessage());
  const responseData = await readLength(byteBuffer, 1);
  const responseCode = responseData[0];
  if (responseCode === TLSResponseCode.Accepted) return await options.upgradeTLS(byteBuffer);
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
