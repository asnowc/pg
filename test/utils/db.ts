import type { DbConnectOption } from "@asla/pg";
import process from "node:process";

const TEST_LOGIN_DB = process.env["TEST_LOGIN_DB"] ?? "pg://postgres@127.0.0.1:5432/postgres";
export const PASSWORD_LOGIN_DB = process.env["TEST_PASSWORD_DB"] ??
  "pg://auth_password:password-secret@127.0.0.1:5432/auth_test";
export const SCRAM_LOGIN_DB = process.env["TEST_SCRAM_DB"] ??
  "pg://auth_scram:scram-secret@127.0.0.1:5432/auth_test";
export const TLS_LOGIN_DB = process.env["TEST_TLS_DB"] ??
  "pg://auth_tls:tls-secret@localhost:5432/auth_test";
export const TLS_CA_FILE = process.env["TEST_TLS_CA"] ?? "./test/fixtures/tls/ca.crt";

export function parseDbUrl(value: string): DbConnectOption {
  const url = new URL(value);
  if (!url.username) throw new Error("Database URL must include a username");
  return {
    database: url.pathname.slice(1),
    hostname: url.hostname,
    port: +(url.port || 5432),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    user: decodeURIComponent(url.username),
  };
}

export const DB_CONNECT_INFO = parseDbUrl(TEST_LOGIN_DB);

export const PUBLIC_DB_CONNECT_INFO = {
  ...DB_CONNECT_INFO,
  database: "test_public",
} satisfies DbConnectOption;
