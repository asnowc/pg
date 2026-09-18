import { createPool, DatabasePool, DatabasePoolConnection, sql } from "slonik";
import { CONNECT_URL } from "../utils/db.ts";
import { ConnectHandler, PoolInfo, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";

export const LIB_NAME = "slonik";

export const poolInfo = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => createPool(CONNECT_URL.toString(), { maxPoolSize: poolSize }),
  closePool: (pool) => pool.end(),
} satisfies PoolInfo<DatabasePool>;

const queries: TestQueries<DatabasePoolConnection | DatabasePool> = {
  select: async (client) => {
    await client.query(sql.unsafe`select 1 as x`);
  },
  selectArg: async (client) => {
    await client.query(sql.unsafe`select ${1} as x`);
  },
  selectArgs: async (client) => {
    await client.query(sql.unsafe`select
      ${1337}::int as int,
      ${"wat"} as string,
      ${sql.date(new Date())}::timestamp with time zone as timestamp,
      ${null} as null,
      ${false}::bool as boolean,
      ${sql.binary(Buffer.from("awesome"))}::bytea as bytea,
      ${sql.json([{ some: "json" }, { array: "object" }])}::jsonb as json
    `);
  },
  selectWhere: async (client) => {
    await client.query(sql.unsafe`select * from pg_catalog.pg_type where typname = ${"bool"}`);
  },
};

type ConnectionOwner = {
  pool: DatabasePool;
  release: () => void;
  closed: Promise<void>;
};
export const connInfo: ConnectHandler<DatabasePoolConnection, ConnectionOwner> = {
  name: LIB_NAME,
  connect: async () => {
    const pool = await createPool(CONNECT_URL.toString(), { maximumPoolSize: 1 });
    const ready = Promise.withResolvers<DatabasePoolConnection>();
    const release = Promise.withResolvers<void>();
    const closed = pool.connect(async (connection) => {
      ready.resolve(connection);
      await release.promise;
    });
    closed.catch(ready.reject);
    return {
      conn: await ready.promise,
      pool: { pool, release: () => release.resolve(), closed },
    };
  },
  close: async (_conn, owner) => {
    owner.release();
    await owner.closed;
    await owner.pool.end();
  },
};
export const queryTest: QueryTest<DatabasePoolConnection, ConnectionOwner> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<DatabasePool> = {
  ...queries,
  ...poolInfo,
};
