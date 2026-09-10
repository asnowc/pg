import pg, { Client, Pool } from "pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { PoolInfo } from "./common.ts";

export function connect() {
  const pgClient = new pg.Client(DB_CONNECT_INFO);
  return pgClient.connect();
}
export const LIB_NAME = "pg";
export function addToBench(bench: Bench, benchFn: (data: Client) => Promise<void>) {
  let pgClient: Client;

  bench.add(LIB_NAME, () => benchFn(pgClient), {
    beforeAll: async () => {
      pgClient = await connect();
      await pgClient.query("select 1 as x");
    },
    afterAll: async () => {
      await pgClient.end();
    },
  });
}
export const poolInfo: PoolInfo<Pool> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => new pg.Pool({ ...DB_CONNECT_INFO, max: poolSize }),
  closePool: (pool) => pool.end(),
};
