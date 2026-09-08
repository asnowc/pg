import postgres from "postgres";
import { DB_CONNECT_INFO } from "../utils/db.ts";

export async function connect() {
  const postgresPool = postgres({ ...DB_CONNECT_INFO, max: 1, idle_timeout: 0, max_lifetime: 0, prepare: false });
  const postgresClient = await postgresPool.reserve();

  return postgresClient;
}
