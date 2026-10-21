import pgPromise, { IDatabase } from "pg-promise";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { ConnectHandler, PoolHandler, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";
const pgp = pgPromise();

type Pool = IDatabase<Record<string, never>>;
type Connection = Awaited<ReturnType<Pool["connect"]>>;

export const LIB_NAME = "pg-promise";

const poolInfo: PoolHandler<ConnInfo> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => {
    const pool = pgp({ ...DB_CONNECT_INFO, max: poolSize });
    return {
      query: pool.query.bind(pool),
      close: () => pool.$pool.end(),
    };
  },
  closePool: (pool) => pool.close(),
};
type ConnInfo = {
  query: Pool["query"] | Connection["query"];
  close: () => Promise<void>;
};
const queries: TestQueries<ConnInfo | Pool> = {
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
const connInfo: ConnectHandler<ConnInfo> = {
  name: LIB_NAME,
  connect: async () => {
    const pool = pgp({ ...DB_CONNECT_INFO, max: 1 });
    const conn = await pool.connect({ direct: true });
    return {
      query: conn.query.bind(conn),
      close: async () => {
        conn.done();
        await pool.$pool.end();
      },
    };
  },
  close: async (conn) => {
    await conn.close();
  },
};

export const queryTest: QueryTest<ConnInfo> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<ConnInfo> = {
  ...queries,
  ...poolInfo,
};
