import { connectFromStream, PgConnectOptions } from "@asla/pg";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { DenoConnByteStream } from "@/platforms.ts";

export async function denoConnect(options: PgConnectOptions) {
  const conn = await Deno.connect({ hostname: PUBLIC_DB_CONNECT_INFO.hostname, port: PUBLIC_DB_CONNECT_INFO.port });
  const stream = new DenoConnByteStream(conn);
  return connectFromStream(stream, options);
}
