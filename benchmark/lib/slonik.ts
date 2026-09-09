import { createPool, DatabasePool, DatabasePoolConnection } from "slonik";
import { CONNECT_URL } from "../utils/db.ts";
import { Bench } from "tinybench";
import { PoolInfo } from "./common.ts";
export { sql as slonkSql } from "slonik";

export const LIB_NAME = "slonik";

export function addToBench(bench: Bench, benchFn: (data: DatabasePoolConnection) => Promise<void>) {
  let pool: DatabasePool;
  let connect: DatabasePoolConnection;
  let promise: PromiseWithResolvers<void>;

  bench.add(LIB_NAME, () => benchFn(connect), {
    beforeAll: async () => {
      pool = await createPool(CONNECT_URL.toString());
      promise = Promise.withResolvers();
      pool.connect(function (connection): Promise<void> {
        connect = connection;
        return promise.promise;
      });
    },
    afterAll: async () => {
      promise.resolve();
      await promise.promise;
      await pool.end();
    },
  });
}

export const poolInfo = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => createPool(CONNECT_URL.toString(), { maxPoolSize: poolSize }),
  closePool: (pool) => pool.end(),
} satisfies PoolInfo<DatabasePool>;
