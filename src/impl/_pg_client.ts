import { connect as nodeConnect } from "node:net";
import type { Duplex } from "node:stream";
import { connectFromStream, type PgConnection } from "../connect.ts";
import { DenoConnByteStream, NodeDuplexByteStream } from "../platforms.ts";
import type { ByteStream } from "../protocol.ts";
import type { DbConnectOption } from "./connect.ts";

export async function createPgClient(options: DbConnectOption): Promise<PgConnection> {
  if (!options.user) throw new TypeError("PostgreSQL user is required");
  const stream = await createByteStream(options.hostname ?? "127.0.0.1", options.port ?? 5432);
  return await connectFromStream(stream, {
    database: options.database,
    user: options.user,
    password: options.password,
  });
}

async function createByteStream(hostname: string, port: number): Promise<ByteStream> {
  if (typeof Deno !== "undefined") {
    return new DenoConnByteStream(await Deno.connect({ hostname, port }));
  }
  const socket = await new Promise<Duplex>((resolve, reject) => {
    const connection = nodeConnect({ host: hostname, port });
    connection.once("connect", () => resolve(connection));
    connection.once("error", reject);
  });
  return new NodeDuplexByteStream(socket);
}
