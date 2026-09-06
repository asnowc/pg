import { expect, test } from "vitest";
import type { PgConnectOptions } from "@asla/pg";
import { denoConnect } from "@test/utils/connect.ts";

const USERS = {
  trust: "auth_trust",
  password: "auth_password",
  scram: "auth_scram",
};

async function authenticate(options: PgConnectOptions): Promise<void> {
  await using conn = await denoConnect(options);
  await conn.simpleQuery(`SELECT 1`);
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
