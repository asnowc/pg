import { DB_CONNECT_INFO } from "./db.ts";
import { PoolInfo, PoolQueryTest, TestQueries } from "./common.ts";
import { FakeRequest, getFakePool } from "@/implement/FakeRequest.ts";

export const LIB_NAME = "fake";

export const poolInfo: PoolInfo<FakeRequest> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) =>
    getFakePool({
      port: DB_CONNECT_INFO.port,
      user: DB_CONNECT_INFO.user,
      password: DB_CONNECT_INFO.password,
      database: DB_CONNECT_INFO.database,
      hostname: DB_CONNECT_INFO.host,
    }, poolSize),
  closePool: (pool) => pool.close(),
};

const queries: TestQueries<FakeRequest> = {
  select: async (client) => {
    await client.query("select 1 as x");
  },
  selectArg: async (client) => {
    await client.query("select 1 as x");
  },
  selectArgs: async (client) => {
    await client.query("select 1 as x");
  },
  selectWhere: async (client) => {
    await client.query("select 1 as x");
  },
};

export const poolQueryTest: PoolQueryTest<FakeRequest> = {
  ...queries,
  ...poolInfo,
};
