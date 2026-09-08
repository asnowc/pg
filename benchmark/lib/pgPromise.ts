import pgPromise, { IDatabase } from "pg-promise";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import type { AddPoolConfig } from "./common.ts";
import { createPoolBench } from "./common.ts";
const pgp = pgPromise();
export async function connect() {
  const conn = await pgp({ ...DB_CONNECT_INFO, max: 1 }).connect({ direct: true });
  return conn;
}
type Pool = IDatabase<{}>;
type Connection = Awaited<ReturnType<typeof connect>>;

export function addToBench(bench: Bench, name: string, benchFn: (data: Connection) => Promise<void>) {
  let pool: IDatabase<{}>;
  let conn: Connection;
  bench.add(name, () => benchFn(conn), {
    beforeAll: async () => {
      pool = await pgp({ ...DB_CONNECT_INFO, max: 1 });
      conn = await pool.connect({ direct: true });
    },
    afterAll: async () => {
      await conn.done();
      await pool.$pool.end();
    },
  });
}
export function addPoolToBench(option: AddPoolConfig<Pool>) {
  return createPoolBench({
    ...option,
    createPool: () => pgp({ ...DB_CONNECT_INFO, max: option.poolSize }),
    closePool: (pool) => pool.$pool.end(),
  });
}
