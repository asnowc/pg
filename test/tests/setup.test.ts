import { expect, test } from "vitest";
import { createSqlBuilder, JS_DATA_ENCODER_V1, PgPool } from "@asla/pg";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";

test("按批读取游标并在完成后归还连接", async () => {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1);
  const connectInfo = PUBLIC_DB_CONNECT_INFO;
  await using dbPool = new PgPool({
    create: () => Deno.connect({ hostname: connectInfo.hostname, port: connectInfo.port }),
    maxCount: 4,
    connect: { user: connectInfo.user, database: connectInfo.database, password: connectInfo.password },
  });

  const rows = await dbPool.query(sql`SELECT 1`).getRows();
  expect(rows).toEqual([[1]]);
});
