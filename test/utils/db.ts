import type { DbConnectOption } from "@asla/pg";
import process from "node:process";

const TEST_LOGIN_DB = process.env["TEST_LOGIN_DB"] ?? "pg://postgres@127.0.0.1:5432/postgres";
const TEXT_PUBLIC_DB = "test_public";

const url = new URL(TEST_LOGIN_DB);
export const DB_CONNECT_INFO = {
  database: url.pathname.slice(1),
  hostname: url.hostname,
  port: +(url.port || 5432),
  password: url.password ? url.password : undefined,
  user: url.username,
};

export const PUBLIC_DB_CONNECT_INFO = {
  ...DB_CONNECT_INFO,
  database: TEXT_PUBLIC_DB,
} satisfies DbConnectOption;
