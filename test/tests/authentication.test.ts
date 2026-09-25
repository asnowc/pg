import { expect, test } from "vitest";
import { PgAuthenticationError, PgConnection, type PgConnectOptions } from "@asla/pg";
import { denoConnect } from "@test/utils/connect.ts";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
const TLS_CA_FILE = "./test/fixtures/tls/ca.crt";

const USER = {
  trust: "auth_trust",
  password: "auth_password",
  scram: "auth_scram",
  tls: "auth_tls",
} as const;

function authenticate(options: Omit<PgConnectOptions<Deno.Conn>, "database"> & { database?: string }) {
  return denoConnect({
    database: PUBLIC_DB_CONNECT_INFO.database,
    hostname: PUBLIC_DB_CONNECT_INFO.hostname,
    port: PUBLIC_DB_CONNECT_INFO.port,
    ...options,
  });
}

test("trust 用户可以连接", async () => {
  await using conn = await authenticate({ user: USER.trust });
});

test("password 用户可以连接", async () => {
  await using conn = await authenticate({ user: USER.password, password: "password-secret" });
});

test("SCRAM 用户可以连接", async () => {
  await using conn = await authenticate({ user: USER.scram, password: "scram-secret" });
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

test("服务端 Startup 错误会拒绝连接", async () => {
  await expect(authenticate({ user: USER.scram, database: "missing_database" })).rejects.toThrow();
});

test("拒绝包含 NUL 的 Startup 参数", async () => {
  await expect(authenticate({ user: USER.scram, database: "invalid\0name" })).rejects.toThrow("NUL");
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
test("TLS fixture 使用受信 CA 建立连接", async () => {
  const conn = await Deno.connect({ hostname: PUBLIC_DB_CONNECT_INFO.hostname, port: PUBLIC_DB_CONNECT_INFO.port });
  await using db = await PgConnection.connect(conn, {
    user: USER.tls,
    database: PUBLIC_DB_CONNECT_INFO.database,
    encryption: {
      mode: "TLS",
      upgradeTLS: async () => {
        const ca = await Deno.readTextFile(TLS_CA_FILE);
        return Deno.startTls(conn, { caCerts: [ca] });
      },
    },
  });
  expect(db.processId).not.toBeNull();
});
