import postgres, { ReservedSql, Sql } from "postgres";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { ConnectHandler, PoolInfo, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";

export const LIB_NAME = "postgres";

export const poolInfo: PoolInfo<Sql> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => postgres({ ...DB_CONNECT_INFO, max: poolSize }),
  closePool: (pool) => pool.end(),
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
  selectWhere: async (sql) => {
    await sql`select * from pg_catalog.pg_type where typname = ${"bool"}`;
  },
};
export const connInfo: ConnectHandler<ReservedSql, Sql> = {
  name: LIB_NAME,
  connect: async () => {
    const pool = postgres({ ...DB_CONNECT_INFO, max: 1, prepare: false });
    const conn = await pool.reserve();
    return { conn, pool };
  },
  close: async (conn, pool) => {
    conn.release();
    await pool.end();
  },
};
export const queryTest: QueryTest<ReservedSql, Sql> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<Sql> = {
  ...queries,
  ...poolInfo,
};
