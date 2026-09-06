import type { DbConnection } from "#abstract";
import { createPgClient } from "./_pg_client.ts";
import { PgConnection } from "./_PgConnection.ts";
/**
 * @public
 * @deprecated 请改用 `PgConnectOptions`。
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
 * @deprecated 请建立 `ByteStream` 后调用 `connectFromStream()`。
 */
export async function createDbConnection(
  url: string | URL | DbConnectOption,
): Promise<DbConnection> {
  let option: DbConnectOption;
  if (typeof url === "string" || url instanceof URL) option = parserDbConnectUrl(url);
  else option = url;

  return new PgConnection(await createPgClient(option));
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
