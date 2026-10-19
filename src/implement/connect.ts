import type {
  ConnectionSource,
  PgConnection as IPgConnection,
  PgConnectOptions,
  PgNetConnectOptions,
} from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect.ts";
import { PgConnection } from "./PgConnection.ts";
import { connectFromDenoTCP, connectFromNodeTCP } from "@/platforms.ts";
/**
 * @public
 */
export async function createSession<T extends ConnectionSource>(
  source: T,
  options: PgConnectOptions<T>,
): Promise<IPgConnection> {
  const session = await connectPgSession(source, options);
  return new PgConnection(session);
}

/**
 * @public
 */
export async function connect(options: PgNetConnectOptions): Promise<IPgConnection> {
  if (typeof globalThis.Deno !== "undefined") {
    return connectFromDenoTCP(options);
  } else {
    return connectFromNodeTCP(options);
  }
}
