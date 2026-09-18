import pg, { Client, Pool } from "pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { ConnectHandler, PoolInfo, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";

async function connect() {
  const pgClient = new pg.Client(DB_CONNECT_INFO);
  await pgClient.connect();
  return pgClient;
}
export const LIB_NAME = "pg";

export const poolInfo: PoolInfo<Pool> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => new pg.Pool({ ...DB_CONNECT_INFO, max: poolSize }),
  closePool: (pool) => pool.end(),
};

const queries: TestQueries<Client | Pool> = {
  select: async (client) => {
    await client.query("select 1 as x");
  },
  selectArg: async (client) => {
    await client.query("select $1 as x", [1]);
  },
  selectArgs: async (client) => {
    await client.query(
      `select
        $1::int as int,
        $2 as string,
        $3::timestamp with time zone as timestamp,
        $4 as null,
        $5::bool as boolean,
        $6::bytea as bytea,
        $7::jsonb as json`,
      [
        1337,
        "wat",
        new Date().toISOString(),
        null,
        false,
        Buffer.from("awesome"),
        JSON.stringify([{ some: "json" }, { array: "object" }]),
      ],
    );
  },
  selectWhere: async (client) => {
    await client.query("select * from pg_catalog.pg_type where typname = $1", ["bool"]);
  },
};
const connInfo: ConnectHandler<Client> = {
  name: LIB_NAME,
  connect: async () => ({ conn: await connect(), pool: undefined }),
  close: (conn) => conn.end(),
};

export const queryTest: QueryTest<Client> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<Pool> = {
  ...queries,
  ...poolInfo,
};
