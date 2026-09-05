import type { ByteStream, PgAuthenticationExchangeOptions, PgStartupOptions, PgTlsOptions } from "@/protocol.ts";
import { auth, negotiateTls, PgMessageReader, startup } from "@/protocol.ts";
import type { PgConnection } from "./PgConnection.ts";

export type { PgTlsOptions } from "@/protocol.ts";
export { PgAuthenticationError, PgProtocolError } from "@/protocol.ts";

export interface PgConnectOptions extends PgStartupOptions, PgAuthenticationExchangeOptions {
  /** 配置后先执行 SSL 协商；未配置时直接使用传入的字节流。 */
  tls?: PgTlsOptions;
  /** 消息帧最大长度限制。 */
  maxMessageSize?: number;
}

/** 链接 postgresql 数据库，并进行认证和初始化。 */
export async function connect(
  byteStream: ByteStream,
  options: PgConnectOptions,
): Promise<PgConnection> {
  const stream = options.tls ? await negotiateTls(byteStream, options.tls) : byteStream;
  await startup(stream, options);
  const reader = new PgMessageReader(stream);
  const session = await auth(reader, options);

  throw new Error("Not implemented");
}
