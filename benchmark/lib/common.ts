import { Bench } from "tinybench";

export type AddPoolConfig<T> = { poolSize: number; bench: Bench; name: string; benchFn: (data: T) => Promise<void> };

export function createPoolBench<T>(
  config: AddPoolConfig<T> & {
    createPool: () => T;
    closePool: (pool: T) => Promise<void>;
  },
) {
  const { bench, name, benchFn, closePool, createPool } = config;
  let pool: T;

  bench.add(name, async () => {
    for (let i = 0; i < 5000; i++) {
      await benchFn(pool);
    }
  }, {
    beforeAll: () => {
      pool = createPool();
    },
    afterAll: async () => {
      await closePool(pool);
    },
  });
}
