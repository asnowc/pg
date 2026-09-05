import { expect, test } from "vitest";
import { DB_CONNECT_INFO, PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { connect, PgConnectOptions } from "@asla/pg";
import { DenoConnByteStream } from "@/platforms.ts";

const USERS = {
  trust: "auth_trust",
  password: "auth_password",
  scram: "auth_scram",
};

async function authenticate(options: PgConnectOptions): Promise<void> {
  await using conn = await denoConnect(options);
  await conn.simpleQuery(`SELECT 1`);
}

async function denoConnect(options: PgConnectOptions) {
  const conn = await Deno.connect({ hostname: PUBLIC_DB_CONNECT_INFO.hostname, port: PUBLIC_DB_CONNECT_INFO.port });
  const stream = new DenoConnByteStream(conn);
  return connect(stream, options);
}
test("trust 用户可以连接", async () => {
  await denoConnect({ user: USERS.trust });
});

test("password 用户可以连接", async () => {
  await denoConnect({ user: USERS.password, password: "password-secret" });
});

test("SCRAM 用户可以连接", async () => {
  await authenticate({ user: USERS.scram, password: "scram-secret" });
});

test("密码错误时认证失败", async () => {
  await expect(authenticate({ user: USERS.scram, password: "wrong-password" })).rejects.toThrow();
});
