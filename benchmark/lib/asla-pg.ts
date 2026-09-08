import { connectFromStream, createSqlBuilder, DenoConnByteStream, JS_DATA_ENCODER_V1 } from "@asla/pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";

export async function connect() {
  const tcp = await Deno.connect({ hostname: DB_CONNECT_INFO.host, port: DB_CONNECT_INFO.port });
  tcp.setNoDelay(true);
  return connectFromStream(new DenoConnByteStream(tcp), DB_CONNECT_INFO);
}

export const aslaSql = createSqlBuilder(JS_DATA_ENCODER_V1);
