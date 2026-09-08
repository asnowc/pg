import postgres, { ReservedSql, Sql } from "postgres";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { AddPoolConfig, createPoolBench } from "./common.ts";

function createPool() {
  return postgres({ ...DB_CONNECT_INFO, max: 1, prepare: false });
}

export function addToBench(bench: Bench, name: string, benchFn: (data: Sql) => Promise<void>) {
  let pool: Sql;
  let connect: ReservedSql;

  bench.add(name, () => benchFn(pool), {
    beforeAll: async () => {
      pool = createPool();
      connect = await pool.reserve();
    },
    afterAll: async () => {
      connect.release();
      await pool.end();
    },
  });
}

export function addPoolToBench(config: AddPoolConfig<Sql>) {
  return createPoolBench({
    ...config,
    createPool: () => postgres({ ...DB_CONNECT_INFO, max: config.poolSize, prepare: false }),
    closePool: (pool) => pool.end(),
  });
}
