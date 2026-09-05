import { DbConnectOption, parserDbConnectUrl } from "@asla/pg";
import process from "node:process";

const TEST_LOGIN_DB = process.env["TEST_LOGIN_DB"] ?? "pg://postgres@127.0.0.1:5432/postgres";
export const DB_CONNECT_INFO = parserDbConnectUrl(TEST_LOGIN_DB);
export const PUBLIC_DB_CONNECT_INFO: DbConnectOption = { ...DB_CONNECT_INFO, database: "test_public" };
