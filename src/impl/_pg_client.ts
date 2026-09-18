import { connect as nodeConnect } from "node:net";
import type { Duplex } from "node:stream";
import { PgConnection as Connection } from "@/implement.ts";
import { createDuplexByteConnection } from "../platforms.ts";
import type { DbConnectOption } from "./connect.ts";
import type { ByteStream } from "@/interface/ByteStream.ts";

export async function createPgClient(options: DbConnectOption): Promise<Connection> {
  if (!options.user) throw new TypeError("PostgreSQL user is required");
  const byteStream = await createByteStream(options.hostname ?? "127.0.0.1", options.port ?? 5432);
  return Connection.connect(byteStream, { database: options.database, user: options.user });
}

async function createByteStream(hostname: string, port: number): Promise<ByteStream> {
  const socket = await new Promise<Duplex>((resolve, reject) => {
    const connection = nodeConnect({ host: hostname, port });
    connection.once("connect", () => resolve(connection));
    connection.once("error", reject);
  });
  return createDuplexByteConnection(socket);
}
