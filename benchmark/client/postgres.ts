import postgres, { Sql } from "postgres";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { ConnectHandler, PoolHandler, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";

export const LIB_NAME = "postgres";

export const poolInfo: PoolHandler<Sql> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => postgres({ ...DB_CONNECT_INFO, max: poolSize, prepare: false }),
  closePool: (pool) => pool.end(),
};
type Conn = postgres.ReservedSql<{}> & {
  __pool: Sql;
};
const queries: TestQueries<Sql> = {
  select: async (sql) => {
    await sql`select 1 as x`;
  },
  selectArg: async (sql) => {
    await sql`select ${1} as x`;
  },
  selectArgs: async (sql) => {
    await sql`select
      ${1337} as int,
      ${"wat"} as string,
      ${new Date()} as timestamp,
      ${null} as null,
      ${false} as boolean,
      ${Buffer.from("awesome")} as bytea,
      ${sql.json([{ some: "json" }, { array: "object" }])} as json
    `;
  },
};
export const connInfo: ConnectHandler<Conn> = {
  name: LIB_NAME,
  connect: async () => {
    const pool = postgres({ ...DB_CONNECT_INFO, max: 1, prepare: false });
    const conn = await pool.reserve();
    Reflect.set(conn, "__pool", pool);
    return conn as Conn;
  },
  close: async (conn) => {
    conn.release();
    const pool = Reflect.get(conn, "__pool") as Sql;
    await pool.end();
  },
};
export const queryTest: QueryTest<Conn> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<Sql> = {
  ...queries,
  ...poolInfo,
};
