import pg, { Client, Pool } from "pg";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { AddPoolConfig, createPoolBench } from "./common.ts";

export function connect() {
  const pgClient = new pg.Client(DB_CONNECT_INFO);
  return pgClient.connect();
}
export function addToBench(bench: Bench, name: string, benchFn: (data: Client) => Promise<void>) {
  let pgClient: Client;

  bench.add(name, () => benchFn(pgClient), {
    beforeAll: async () => {
      pgClient = await connect();
    },
    afterAll: async () => {
      await pgClient.end();
    },
  });
}
export function addPoolToBench(config: AddPoolConfig<Pool>) {
  return createPoolBench({
    ...config,
    createPool: () => new pg.Pool({ ...DB_CONNECT_INFO, max: config.poolSize }),
    closePool: (pgPool) => pgPool.end(),
  });
}
