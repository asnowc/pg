import pgPromise, { IDatabase } from "pg-promise";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { ConnectHandler, PoolInfo, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";
const pgp = pgPromise();

type Pool = IDatabase<Record<string, never>>;
type Connection = Awaited<ReturnType<Pool["connect"]>>;

export const LIB_NAME = "pg-promise";

export const poolInfo: PoolInfo<Pool> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => pgp({ ...DB_CONNECT_INFO, max: poolSize }),
  closePool: (pool) => pool.$pool.end(),
};

const queries: TestQueries<Connection | Pool> = {
  select: async (client) => {
    await client.any("select 1 as x");
  },
  selectArg: async (client) => {
    await client.any("select $1 as x", [1]);
  },
  selectArgs: async (client) => {
    await client.any(
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
const connInfo: ConnectHandler<Connection, Pool> = {
  name: LIB_NAME,
  connect: async () => {
    const pool = pgp({ ...DB_CONNECT_INFO, max: 1 });
    return { conn: await pool.connect({ direct: true }), pool };
  },
  close: async (conn, pool) => {
    conn.done();
    await pool.$pool.end();
  },
};

export const queryTest: QueryTest<Connection, Pool> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<Pool> = {
  ...queries,
  ...poolInfo,
};
