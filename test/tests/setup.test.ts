import { test } from "@test/fixtures/db_connect.ts";
import { connect, createSqlBuilder, JS_DATA_ENCODER_V1, PgPool } from "@asla/pg";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { expect } from "vitest";

test("使用示例", async () => {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1);
  const connectInfo = PUBLIC_DB_CONNECT_INFO;
  await using dbPool = new PgPool({
    create: async () => {
      const stream = await Deno.connect({ hostname: connectInfo.hostname, port: connectInfo.port });
      return {
        stream,
        connectOptions: { user: connectInfo.user, database: connectInfo.database, password: connectInfo.password },
      };
    },
    maxCount: 4,
  });

  const rows = await dbPool.query(sql`SELECT 1 AS value`).rows();
  expect(rows).toEqual([{ value: 1 }]);
});

test("使用示例", async () => {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1);
  const connectInfo = PUBLIC_DB_CONNECT_INFO;
  const stream = await Deno.connect({ hostname: connectInfo.hostname, port: connectInfo.port });
  await using conn = await connect(stream, {
    database: connectInfo.database,
    user: connectInfo.user,
    password: connectInfo.password,
  });
  conn.finished.catch((e) => {
    console.error(e);
  });
  const rows = await conn.query(sql`SELECT 1 AS value`).rows();
  expect(rows).toEqual([{ value: 1 }]);
});
