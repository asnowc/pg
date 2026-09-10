import postgres, { ReservedSql, Sql } from "postgres";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { PoolInfo } from "./common.ts";

export const LIB_NAME = "postgres";
export function addToBench(bench: Bench, benchFn: (data: Sql) => Promise<void>) {
  let pool: Sql;
  let connect: ReservedSql;

  bench.add(LIB_NAME, () => benchFn(connect), {
    beforeAll: async () => {
      pool = postgres({ ...DB_CONNECT_INFO, max: 1, prepare: false });
      connect = await pool.reserve();
      await connect`select 1 as x`;
    },
    async: true,
    afterAll: async () => {
      connect.release();
      await pool.end();
    },
  });
}
export const poolInfo: PoolInfo<Sql> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => postgres({ ...DB_CONNECT_INFO, max: poolSize }),
  closePool: (pool) => pool.end(),
};
