import pgPromise from "pg-promise";
import { DB_CONNECT_INFO } from "../utils/db.ts";
const pgp = pgPromise();

export async function connect() {
  return await pgp({ ...DB_CONNECT_INFO, max: 1, idleTimeoutMillis: 0 }).connect({ direct: true });
}
