import { test } from "@test/fixtures/db_connect.ts";
import { connectFromNet, createSqlBuilder, JS_DATA_ENCODER_V1, PG_DATA_DECODER_V1, PgPool } from "@asla/pg";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";
import { expect } from "vitest";

test("使用示例", async () => {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1, PG_DATA_DECODER_V1);
  const connectInfo = PUBLIC_DB_CONNECT_INFO;
  await using dbPool = new PgPool({
    create: async () => connectFromNet(connectInfo),
    maxCount: 4,
  });

  const rows = await dbPool.query(sql`SELECT 1 AS value`).rows();
  expect(rows).toEqual([{ value: 1 }]);
});

test("使用示例", async () => {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1, PG_DATA_DECODER_V1);
  const connectInfo = PUBLIC_DB_CONNECT_INFO;
  await using conn = await connectFromNet(connectInfo);
  conn.finished.catch((e) => {
    console.error(e);
  });
  const rows = await conn.query(sql`SELECT 1 AS value`).rows();
  expect(rows).toEqual([{ value: 1 }]);
});
