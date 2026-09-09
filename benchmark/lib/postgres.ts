import postgres, { ReservedSql, Sql } from "postgres";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { PoolInfo } from "./common.ts";

function createPool() {
  return postgres({ ...DB_CONNECT_INFO, max: 1, prepare: false });
}
export const LIB_NAME = "postgres";
export function addToBench(bench: Bench, benchFn: (data: Sql) => Promise<void>) {
  let pool: Sql;
  let connect: ReservedSql;

  bench.add(LIB_NAME, () => benchFn(pool), {
    beforeAll: async () => {
      pool = createPool();
      connect = await pool.reserve();
    },
    afterAll: async () => {
      console.log(`111`);
      connect.release();
      await connect.end();
      await pool.end();
      console.log(`$postgres connection closed`);
    },
  });
}
export const poolInfo: PoolInfo<Sql> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => postgres({ ...DB_CONNECT_INFO, max: poolSize, prepare: false }),
  closePool: (pool) => pool.end(),
};
