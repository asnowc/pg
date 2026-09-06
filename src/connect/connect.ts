import type { ByteStream, PgAuthenticationExchangeOptions, PgStartupOptions, PgTlsOptions } from "@/protocol.ts";
import { auth, negotiateTls, PgMessageReader, startup } from "@/protocol.ts";
import type { PgConnection } from "./PgConnection.ts";
import { PgConnectionImpl } from "./PgConnectionImpl.ts";

export type { PgTlsOptions } from "@/protocol.ts";
export { PgAuthenticationError, PgProtocolError } from "@/protocol.ts";

/** @public */
export interface PgConnectOptions extends PgStartupOptions, PgAuthenticationExchangeOptions {
  /** 配置后先执行 SSL 协商；未配置时直接使用传入的字节流。 */
  tls?: PgTlsOptions;
  /** 消息帧最大长度限制。 */
  maxMessageSize?: number;
}

/**
 * 链接 postgresql 数据库，并进行认证和初始化。
 * @public
 */
export async function connectFromStream(
  byteStream: ByteStream,
  options: PgConnectOptions,
): Promise<PgConnection> {
  let stream = byteStream;
  try {
    stream = options.tls ? await negotiateTls(stream, options.tls) : stream;
    await startup(stream, options);
    const reader = new PgMessageReader(stream, options.maxMessageSize);
    const session = await auth(reader, options);
    return new PgConnectionImpl(stream, session, reader);
  } catch (error) {
    stream.close();
    throw error;
  }
}
