import type { DbConnectOption } from "@asla/pg";
import process from "node:process";

const TEST_LOGIN_DB = process.env["TEST_LOGIN_DB"] ?? "pg://postgres@127.0.0.1:5432/postgres";
const url = new URL(TEST_LOGIN_DB);
if (!url.username) throw new Error("Database URL must include a username");
export const DB_CONNECT_INFO = {
  database: url.pathname.slice(1),
  hostname: url.hostname,
  port: +url.port,
  password: url.password ? url.password : undefined,
  user: url.username,
} satisfies DbConnectOption;

export const PUBLIC_DB_CONNECT_INFO = {
  ...DB_CONNECT_INFO,
  database: "test_public",
} satisfies DbConnectOption;
