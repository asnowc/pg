import { expect, test } from "vitest";
import { connectFromStream, DenoConnByteStream, PgAuthenticationError, type PgConnectOptions } from "@asla/pg";
import { denoConnect } from "@test/utils/connect.ts";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";

const TLS_CA_FILE = "./test/fixtures/tls/ca.crt";

const USER = {
  trust: "auth_trust",
  password: "auth_password",
  scram: "auth_scram",
  tls: "auth_tls",
} as const;

function authenticate(options: PgConnectOptions) {
  return denoConnect({
    ...options,
    database: PUBLIC_DB_CONNECT_INFO.database,
    hostname: PUBLIC_DB_CONNECT_INFO.hostname,
    port: PUBLIC_DB_CONNECT_INFO.port,
  });
}

test("trust 用户可以连接", async () => {
  await using conn = await authenticate({ user: USER.trust });
  await conn.query("SELECT 1").getRowCount();
});

test("password 用户可以连接", async () => {
  await using conn = await authenticate({ user: USER.password, password: "password-secret" });
  await conn.query("SELECT 1").getRowCount();
});

test("SCRAM 用户可以连接", async () => {
  await using conn = await authenticate({ user: USER.scram, password: "scram-secret" });
  await conn.query("SELECT 1").getRowCount();
});

test("密码错误时认证失败", async () => {
  await expect(authenticate({ user: USER.password, password: "wrong-password" })).rejects.toThrow(
    PgAuthenticationError,
  );
});

test("密码回调只在服务端请求密码时执行", async () => {
  let calls = 0;
  await using conn = await authenticate({
    user: USER.scram,
    password: () => {
      calls++;
      return "scram-secret";
    },
  });
  expect(calls).toBe(1);
});

test("Startup 参数进入 session", async () => {
  await using conn = await authenticate({
    user: USER.trust,
    applicationName: "asla-pg-auth-test",
    parameters: { search_path: "public" },
  });
  const result = await conn.query<{ user: string; database: string; application_name: string }>(
    "SELECT current_user AS user, current_database() AS database, current_setting('application_name') AS application_name",
  ).getFirstRow();
  expect(result).toEqual({
    user: USER.trust,
    database: PUBLIC_DB_CONNECT_INFO.database,
    application_name: "asla-pg-auth-test",
  });
});

test("服务端 Startup 错误会拒绝连接", async () => {
  await expect(authenticate({ user: USER.scram, database: "missing_database" })).rejects.toThrow();
});

test("拒绝包含 NUL 的 Startup 参数", async () => {
  await expect(authenticate({ user: USER.scram, applicationName: "invalid\0name" })).rejects.toThrow("NUL");
});

test("服务端拒绝客户端选择的不支持 SASL 机制", async () => {
  await expect(authenticate({
    user: USER.scram,
    createSaslExchange: () => ({
      mechanism: "UNSUPPORTED",
      initialResponse: () => new Uint8Array(),
      continue: () => new Uint8Array(),
    }),
  })).rejects.toThrow();
});
test("TLS fixture 使用受信 CA 并由服务端确认加密", async () => {
  const conn = await Deno.connect({ hostname: PUBLIC_DB_CONNECT_INFO.hostname, port: PUBLIC_DB_CONNECT_INFO.port });
  const stream = new DenoConnByteStream(conn);
  await using db = await connectFromStream(stream, {
    user: USER.tls,
    database: PUBLIC_DB_CONNECT_INFO.database,
    tls: {
      mode: "require",
      upgrade: async () => {
        const ca = await Deno.readTextFile(TLS_CA_FILE);
        const tlsConn = await Deno.startTls(conn, { caCerts: [ca] });
        return new DenoConnByteStream(tlsConn);
      },
    },
  });
  const row = await db.query<{ ssl: boolean; version: string }>(`
    SELECT ssl, version
    FROM pg_stat_ssl
    WHERE pid = pg_backend_pid()
  `).getFirstRow();

  expect(row?.ssl).toBe(true);
  expect(row?.version).toMatch(/^TLSv1\./);
});
