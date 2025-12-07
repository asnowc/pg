import type { DbConnection } from "@asla/yoursql/client";
import { createPgClient } from "./_pg_client.ts";
import { PgConnection } from "./_PgConnection.ts";
/** @public */
export interface DbConnectOption {
  database: string;
  user?: string;
  password?: string;
  hostname?: string;
  port?: number;
}

/** @public */
export async function createDbConnection(
  url: string | URL | DbConnectOption,
): Promise<DbConnection> {
  let option: DbConnectOption;
  if (typeof url === "string" || url instanceof URL) option = parserDbConnectUrl(url);
  else option = url;

  const pgClient = createPgClient(option);
  await pgClient.connect();
  return new PgConnection(pgClient);
}

/** @public */
export function parserDbConnectUrl(url: URL | string): DbConnectOption {
  if (typeof url === "string") url = new URL(url);
  return {
    database: url.pathname.slice(1),
    hostname: url.hostname,
    port: +url.port,
    password: url.password ? url.password : undefined,
    user: url.username ? url.username : undefined,
  };
}
