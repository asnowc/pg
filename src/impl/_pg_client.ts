import { Client } from "../driver/mod.js";
import { DbConnectOption } from "./connect.ts";

export function createPgClient(c: DbConnectOption): Client {
  return new Client({
    database: c.database,
    host: c.hostname,
    port: c.port,
    user: c.user,
    password: c.password,
  });
}
