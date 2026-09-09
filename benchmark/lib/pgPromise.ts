import pgPromise, { IDatabase } from "pg-promise";
import { DB_CONNECT_INFO } from "../utils/db.ts";
import { Bench } from "tinybench";
import { PoolInfo } from "./common.ts";
const pgp = pgPromise();
export async function connect() {
  const conn = await pgp({ ...DB_CONNECT_INFO, max: 1 }).connect({ direct: true });
  return conn;
}
type Pool = IDatabase<{}>;
type Connection = Awaited<ReturnType<typeof connect>>;

export const LIB_NAME = "pg-promise";
export function addToBench(bench: Bench, benchFn: (data: Connection) => Promise<void>) {
  let pool: IDatabase<{}>;
  let conn: Connection;
  bench.add(LIB_NAME, () => benchFn(conn), {
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
export const poolInfo: PoolInfo<Pool> = {
  name: LIB_NAME,
  createPool: ({ poolSize }) => pgp({ ...DB_CONNECT_INFO, max: poolSize }),
  closePool: (pool) => pool.$pool.end(),
};
