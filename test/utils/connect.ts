import { PgConnection, type PgConnectOptions } from "@asla/pg";

export interface TestConnectOptions extends PgConnectOptions {
  hostname: string;
  port: number;
}

export async function denoConnect(options: TestConnectOptions): Promise<PgConnection> {
  const hostname = options.hostname;
  const port = options.port;
  const conn = await Deno.connect({ hostname, port });
  return PgConnection.connect(conn, options);
}
