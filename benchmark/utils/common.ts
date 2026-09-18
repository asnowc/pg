import { Bench } from "tinybench";

export type PoolInfo<T> = {
  createPool: (info: { poolSize: number }) => Promise<T> | T;
  closePool: (pool: T) => Promise<void>;
  name: string;
};

export function addQueryBench<T, P>(options: {
  bench: Bench;
  hook: ConnectHandler<T, P>;
  benchFn: (client: T) => Promise<void>;

  warmupTime: number;
}) {
  const { hook, benchFn, bench, warmupTime } = options;
  let conn: { pool: any; conn: T };
  bench.add(hook.name, () => benchFn(conn.conn), {
    beforeAll: async () => {
      conn = await hook.connect();
      for (let i = 0; i < warmupTime; i++) {
        await benchFn(conn.conn);
      }
    },
    afterAll: async () => {
      await hook.close(conn.conn, conn.pool);
    },
    async: true,
  });
}
export type AddPoolBenchOptions<T> = {
  concurrency: number;
  poolSize: number;
  bench: Bench;
  poolHandler: PoolHandler<T>;
  benchFn: (client: T) => Promise<void>;
};
export function addPoolQueryBench<T>(options: AddPoolBenchOptions<T>) {
  const { concurrency, poolSize, poolHandler, benchFn, bench } = options;

  function run(pool: T, size: number) {
    return new Promise((resolve, reject) => {
      let count = 0;
      for (let i = 0; i < size; i++) {
        benchFn(pool).then(() => {
          count++;
          if (count >= size) {
            resolve(undefined);
          }
        }, reject);
      }
    });
  }
  let pool: T;
  bench.add(poolHandler.name, () => run(pool, concurrency), {
    beforeAll: async () => {
      pool = await poolHandler.createPool({ poolSize });
      await run(pool, poolSize * 2);
    },
    afterAll: async () => {
      await poolHandler.closePool(pool);
    },
    async: true,
  });
}
export interface TestQueries<T> {
  select: (client: T) => Promise<void>;
  selectArg: (client: T) => Promise<void>;
  selectArgs: (client: T) => Promise<void>;
  selectWhere: (client: T) => Promise<void>;
}
export type PoolHandler<T> = {
  createPool: (info: { poolSize: number }) => Promise<T> | T;
  closePool: (pool: T) => Promise<void>;
  name: string;
};

export type ConnectHandler<T, P = void> = {
  name: string;
  connect: () => Promise<{ pool: P; conn: T }>;
  close: (conn: T, pool: P) => Promise<void>;
};

export type QueryTest<T, P = void> = TestQueries<T> & ConnectHandler<T, P>;
export type PoolQueryTest<T> = TestQueries<T> & PoolHandler<T>;
