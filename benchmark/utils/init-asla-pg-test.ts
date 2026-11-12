import { ConnectHandler, PoolHandler, PoolQueryTest, QueryTest, TestQueries } from "./common.ts";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import type { PgConnection, PgPool } from "@asla/pg";

const BUFFER_DATA = Buffer.from("awesome");
const JSON_DATA = [{ some: "json" }, { array: "object" }];

export function initTest(
  {
    createSqlBuilder,
    JS_DATA_ENCODER_V1,
    PG_DATA_DECODER_V1,
    connectFromNet,
    connectFromNodeTCP,
    PgPool,
  }: typeof import("@asla/pg"),
  name: string = "@asla/pg",
  node = false,
) {
  const sql = createSqlBuilder(JS_DATA_ENCODER_V1, PG_DATA_DECODER_V1);
  const c = node ? connectFromNodeTCP : connectFromNet;
  function connect() {
    return c({
      hostname: DB_CONNECT_INFO.host,
      port: DB_CONNECT_INFO.port,
      user: DB_CONNECT_INFO.user,
      database: DB_CONNECT_INFO.database,
      password: DB_CONNECT_INFO.password,
    });
  }
  const queries: TestQueries<PgConnection | PgPool> = {
    select: async (client) => {
      await client.query("select 1 as x").rows();
    },
    selectArg: async (client) => {
      await client.query(sql`select ${1} as x`).rows();
    },
    selectArgs: async (client) => {
      await client.query(sql`select
      ${1337}::int as int,
      ${"wat"} as string,
      ${new Date()}::timestamp with time zone as timestamp,
      ${null} as null,
      ${false}::bool as boolean,
      ${BUFFER_DATA}::bytea as bytea,
      ${JSON.stringify(JSON_DATA)}::jsonb as json
    `).rows();
    },
  };
  const connInfo: ConnectHandler<PgConnection> = {
    name,
    connect: () => connect(),
    close: (conn) => conn.close(),
  };

  const queryTest: QueryTest<PgConnection> = {
    ...queries,
    ...connInfo,
  };

  const poolInfo: PoolHandler<PgPool> = {
    name,
    createPool: ({ poolSize }) =>
      new PgPool({
        ...DB_CONNECT_INFO,
        maxCount: poolSize,
        maxPipeline: 100,
        create: async () => {
          const conn = await c({
            database: DB_CONNECT_INFO.database,
            hostname: DB_CONNECT_INFO.host,
            port: DB_CONNECT_INFO.port,
            user: DB_CONNECT_INFO.user,
            password: DB_CONNECT_INFO.password,
          });
          return conn;
        },
      }),
    closePool: (pool) => pool.close(),
  };

  const poolQueryTest: PoolQueryTest<PgPool> = {
    ...queries,
    ...poolInfo,
  };

  return {
    queryTest,
    poolQueryTest,
  };
}
