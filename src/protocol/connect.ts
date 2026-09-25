import type { PgConnectOptions, TLSEncryptionOptions } from "@/interface/Connection.ts";
import { PROTOCOL_VERSION, TLSResponseCode } from "./const.ts";
import { PgAuthenticationError } from "@/error.ts";
import { encodeNegotiateTlsMessage, encodeStartupMessage } from "./encode.ts";
import { startAuthentication } from "./auth.ts";
import { UnexpectedEOFError } from "@/_utils/error.ts";
import { PgSession } from "@/protocol.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { ConnectionSource } from "@asla/pg";
import { Duplex } from "node:stream";
import { DenoBufferStream, NodeBufferStream } from "@/platforms.ts";

function createConnectionStream<T extends ConnectionSource>(source: T): ConnectionStream {
  let stream: ConnectionStream;
  if (source instanceof Duplex) {
    stream = new NodeBufferStream(source);
  } else {
    stream = new DenoBufferStream(source);
  }
  return stream;
}
export async function connectPgSession<T extends ConnectionSource>(
  source: T,
  options: PgConnectOptions<T>,
): Promise<PgSession> {
  const { encryption, maxMessageSize, user, database } = options;
  let stream = createConnectionStream(source);
  if (encryption) {
    //TODO: 查询服务器支持的加密方式
    const encryptionOptions = typeof encryption === "function" ? await encryption() : encryption;
    if (encryptionOptions) {
      if (encryptionOptions.mode === "TLS") {
        const newSource = await negotiateTls(stream, source, encryptionOptions);
        stream = createConnectionStream(newSource);
      } else {
        throw new PgAuthenticationError(`Unsupported encryption mode: ${encryptionOptions.mode}`);
      }
    }
  }
  try {
    const startupMessage = encodeStartupMessage(
      PROTOCOL_VERSION,
      getStartupParameters({ user, database }),
    );
    stream.pushData(startupMessage);
    const info = await startAuthentication(stream, options);
    return new PgSession(stream, { maxMessageSize, authResult: info });
  } catch (error) {
    stream.destroy();
    throw error;
  }
}

/**
 * 发送 SSLRequest，并在服务端接受时调用注入的 TLS 升级函数。
 */
async function negotiateTls<T>(
  stream: ConnectionStream,
  source: T,
  encryptionOptions: TLSEncryptionOptions<T>,
): Promise<ConnectionSource> {
  stream.pushData(encodeNegotiateTlsMessage());
  return new Promise<ConnectionSource>((resolve, reject) => {
    stream.startReadLoop(() => {
      const responseCode = stream.readUInt8();
      if (responseCode === TLSResponseCode.Accepted) resolve(encryptionOptions.upgradeTLS(source));
      else if (responseCode === TLSResponseCode.Rejected) {
        reject(new PgAuthenticationError("PostgreSQL server refused TLS"));
      } else {
        reject(new PgAuthenticationError(`Invalid PostgreSQL SSL response: 0x${responseCode.toString(16)}`));
      }
      return true;
    }, () => {
      reject(new UnexpectedEOFError());
    });
  });
}
/**
 * StartupMessage 的参数。user 是协议要求的唯一必填参数。
 */
interface PgStartupOptions {
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
