import { afterAll, describe, expect, test } from "vitest";
import { createDbConnection } from "@asla/pg";

const baseUrl = process.env.AUTH_TEST_DB ?? "";
const enabled = baseUrl.length > 0;
const connections: Array<{ close(): Promise<void> }> = [];

function connectionUrl(user: string, password?: string): string {
  const url = new URL(baseUrl);
  url.username = user;
  url.password = password ?? "";
  return url.toString();
}

async function authenticate(user: string, password?: string): Promise<void> {
  const connection = await createDbConnection(connectionUrl(user, password));
  connections.push(connection);
  const result = await connection.query<{ current_user: string }>("SELECT current_user");
  expect(result.rows[0]?.current_user).toBe(user);
}

afterAll(async () => {
  await Promise.all(connections.map((connection) => connection.close()));
});

describe.skipIf(!enabled)("PostgreSQL 真实认证", () => {
  test("trust 用户可以连接", async () => {
    await authenticate("auth_trust");
  });

  test("password 用户可以连接", async () => {
    await authenticate("auth_password", "password-secret");
  });

  test("SCRAM 用户可以连接", async () => {
    await authenticate("auth_scram", "scram-secret");
  });

  test("密码错误时认证失败", async () => {
    await expect(createDbConnection(connectionUrl("auth_scram", "wrong-password"))).rejects.toThrow();
  });
});
