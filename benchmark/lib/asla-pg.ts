import {
  connectFromStream,
  createPgPool,
  createSqlBuilder,
  DenoConnByteStream,
  JS_DATA_ENCODER_V1,
  PgConnection,
  PgPool,
} from "@asla/pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { ConnectHandler, PoolInfo, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";
const sql = createSqlBuilder(JS_DATA_ENCODER_V1);

async function connect() {
  const tcp = await Deno.connect({ hostname: DB_CONNECT_INFO.host, port: DB_CONNECT_INFO.port });
  tcp.setNoDelay(true);
  return connectFromStream(new DenoConnByteStream(tcp), DB_CONNECT_INFO);
}

export const LIB_NAME = "@asla/pg";

const queries: TestQueries<PgConnection | PgPool> = {
  select: async (client) => {
    await client.query("select 1 as x").getRows();
  },
  selectArg: async (client) => {
    await client.query(sql`select ${1} as x`).getRows();
  },
  selectArgs: async (client) => {
    await client.query(sql`select
      ${1337}::int as int,
      ${"wat"} as string,
      ${new Date()}::timestamp with time zone as timestamp,
      ${null} as null,
      ${false}::bool as boolean,
      ${Buffer.from("awesome")}::bytea as bytea,
      ${JSON.stringify([{ some: "json" }, { array: "object" }])}::jsonb as json
    `).getRows();
  },
  selectWhere: async (client) => {
    await client.query(sql`select * from pg_catalog.pg_type where typname = ${"bool"}`).getRows();
  },
};
const connInfo: ConnectHandler<PgConnection> = {
  name: LIB_NAME,
  connect: async () => ({ conn: await connect(), pool: undefined }),
  close: (conn) => conn.close(),
};

export const queryTest: QueryTest<PgConnection> = {
  ...queries,
  ...connInfo,
};

const poolInfo: PoolInfo<PgPool> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => createPgPool({ ...DB_CONNECT_INFO, maxCount: poolSize, create: connect }),
  closePool: (pool) => pool.close(),
};

export const poolQueryTest: PoolQueryTest<PgPool> = {
  ...queries,
  ...poolInfo,
};
