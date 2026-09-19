import { expect, test } from "vitest";
import { createSqlBuilder, JS_DATA_ENCODER_V1, PgPool } from "@asla/pg";
import { PUBLIC_DB_CONNECT_INFO } from "@test/utils/db.ts";

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

  const rows = await dbPool.query(sql`SELECT 1 AS value`).getRows();
  expect(rows).toEqual([{ value: 1 }]);
});
