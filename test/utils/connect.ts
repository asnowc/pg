import { connectFromStream, DenoConnByteStream, type PgConnectOptions } from "@asla/pg";

export interface TestConnectOptions extends PgConnectOptions {
  hostname: string;
  port: number;
}

export async function denoConnect(options: TestConnectOptions) {
  const hostname = options.hostname;
  const port = options.port;
  const conn = await Deno.connect({ hostname, port });
  const stream = new DenoConnByteStream(conn);
  return await connectFromStream(stream, options);
}
