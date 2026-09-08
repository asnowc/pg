import pg from "pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";

export async function connect() {
  const pgClient = new pg.Client(DB_CONNECT_INFO);
  await pgClient.connect();

  return pgClient;
}
