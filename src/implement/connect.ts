import type { ConnectionSource, PgConnection as IPgConnection, PgConnectOptions } from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect.ts";
import { PgConnection } from "./PgConnection.ts";

export async function connect<T extends ConnectionSource>(
  source: T,
  options: PgConnectOptions<T>,
): Promise<IPgConnection> {
  const session = await connectPgSession(source, options);
  return new PgConnection(session);
}
