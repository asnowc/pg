import type { DbConnection } from "#abstract";
import { PgConnection as Conn } from "./_PgConnection.ts";
import { createPgClient } from "./_pg_client.ts";

/**
 * @public
 * @deprecated 已废弃。
 */
export interface DbConnectOption {
  database: string;
  user?: string;
  password?: string;
  hostname?: string;
  port?: number;
}

/**
 * @public
 * @deprecated  已废弃。
 */
export async function createDbConnection(
  url: string | URL | DbConnectOption,
): Promise<DbConnection> {
  let option: DbConnectOption;
  if (typeof url === "string" || url instanceof URL) option = parserDbConnectUrl(url);
  else option = url;

  const conn = await createPgClient(option);
  return new Conn(conn);
}

/**
 * @public
 * @deprecated 请自行解析连接 URL 并构造 `PgConnectOptions`。
 */
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
