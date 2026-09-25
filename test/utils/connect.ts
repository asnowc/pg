import { PgConnection, type PgConnectOptions } from "@asla/pg";

export interface TestConnectOptions extends PgConnectOptions<Deno.Conn> {
  hostname: string;
  port: number;
}

export async function denoConnect(options: TestConnectOptions): Promise<PgConnection> {
  const conn = await Deno.connect({ hostname: options.hostname, port: options.port });
  return PgConnection.connect(conn, options);
}
