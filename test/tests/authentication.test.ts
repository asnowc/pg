import { expect, test } from "vitest";
import { DbCursor, PgConnectOptions, PgCursor } from "@asla/pg";
import { denoConnect } from "@test/utils/connect.ts";
import { DB_CONNECT_INFO, PASSWORD_LOGIN_DB, SCRAM_LOGIN_DB } from "@test/utils/db.ts";

const USERS = {
  trust: "auth_trust",
  password: "auth_password",
  scram: "auth_scram",
};

function fromUrl(value: string): PgConnectOptions & { hostname: string; port: number } {
  const url = new URL(value);
  return {
    hostname: url.hostname,
    port: +(url.port || 5432),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
}

async function authenticate(options: PgConnectOptions & { hostname?: string; port?: number }): Promise<void> {
  await using conn = await denoConnect(options);
  for await (const result of conn.simpleQuery(`SELECT 1`)) {
    expect(result.rows).toHaveLength(1);
  }
}

test("trust 用户可以连接", async () => {
  await authenticate({
    hostname: DB_CONNECT_INFO.hostname,
    port: DB_CONNECT_INFO.port,
    user: USERS.trust,
    database: "auth_test",
  });
});

test("password 用户可以连接", async () => {
  await authenticate(fromUrl(PASSWORD_LOGIN_DB));
});

test("SCRAM 用户可以连接", async () => {
  await authenticate(fromUrl(SCRAM_LOGIN_DB));
});

test("密码错误时认证失败", async () => {
  await expect(authenticate({ ...fromUrl(SCRAM_LOGIN_DB), password: "wrong-password" })).rejects.toThrow();
});

test("密码回调只在服务端请求密码时执行", async () => {
  let calls = 0;
  await authenticate({
    ...fromUrl(SCRAM_LOGIN_DB),
    password: () => {
      calls++;
      return "scram-secret";
    },
  });
  expect(calls).toBe(1);
});

test("Startup 参数进入 session", async () => {
  await using conn = await denoConnect({
    ...fromUrl(SCRAM_LOGIN_DB),
    applicationName: "asla-pg-auth-test",
    parameters: { search_path: "public" },
  });
  const results = [];
  for await (
    const result of conn.simpleQuery(
      "SELECT current_user AS user, current_database() AS database, current_setting('application_name') AS application_name",
    )
  ) results.push(...result.rows);
  expect(results).toEqual([{
    user: USERS.scram,
    database: "auth_test",
    application_name: "asla-pg-auth-test",
  }]);
});

test("服务端 Startup 错误会拒绝连接", async () => {
  await expect(authenticate({ ...fromUrl(SCRAM_LOGIN_DB), database: "missing_database" })).rejects.toThrow();
});

test("拒绝包含 NUL 的 Startup 参数", async () => {
  await expect(authenticate({ ...fromUrl(SCRAM_LOGIN_DB), applicationName: "invalid\0name" })).rejects.toThrow("NUL");
});

test("服务端拒绝客户端选择的不支持 SASL 机制", async () => {
  await expect(authenticate({
    ...fromUrl(SCRAM_LOGIN_DB),
    createSaslExchange: () => ({
      mechanism: "UNSUPPORTED",
      initialResponse: () => new Uint8Array(),
      continue: () => new Uint8Array(),
    }),
  })).rejects.toThrow();
});
