import { createPool, DatabasePool, DatabasePoolConnection, sql } from "slonik";
import { CONNECT_URL } from "../utils/db.ts";
import { ConnectHandler, PoolHandler, PoolQueryTest, QueryTest, TestQueries } from "../utils/common.ts";

export const LIB_NAME = "slonik";

const poolInfo = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => createPool(CONNECT_URL.toString(), { maxPoolSize: poolSize }),
  closePool: (pool) => pool.end(),
} satisfies PoolHandler<DatabasePool>;

const BUFFER_DATA = Buffer.from("awesome");
const JSON_DATA = [{ some: "json" }, { array: "object" }];
const queries: TestQueries<Conn | DatabasePool> = {
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
      ${sql.binary(BUFFER_DATA)}::bytea as bytea,
      ${sql.json(JSON_DATA)}::jsonb as json
    `);
  },
};
type Conn = {
  query: DatabasePoolConnection["query"];
  close: () => Promise<void>;
};

export const connInfo: ConnectHandler<Conn> = {
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
    const conn = await ready.promise;
    return {
      close: async () => {
        release.resolve();
        await closed;
        await pool.end();
      },
      query: conn.query.bind(conn),
    };
  },
  close: async (conn) => {
    await conn.close();
  },
};
export const queryTest: QueryTest<Conn> = {
  ...queries,
  ...connInfo,
};

export const poolQueryTest: PoolQueryTest<DatabasePool> = {
  ...queries,
  ...poolInfo,
};
