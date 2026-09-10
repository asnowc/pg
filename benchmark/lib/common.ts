import { Bench } from "tinybench";

export type CreatePoolBenchOptions = {
  concurrency: number;
  poolSize: number;
};

export type PoolInfo<T> = {
  createPool: (info: { poolSize: number }) => Promise<T> | T;
  closePool: (pool: T) => Promise<void>;
  name: string;
};

type AddPoolBench = <T>(info: PoolInfo<T>, benchFn: (data: T, index: number) => Promise<void>) => void;

export function createPoolBench(bench: Bench, options: CreatePoolBenchOptions): AddPoolBench {
  const { concurrency, poolSize } = options;
  return function <T>(info: PoolInfo<T>, benchFn: (data: T, index: number) => Promise<void>) {
    const { name, createPool, closePool } = info;
    let pool: T;

    function run(pool: T, size: number) {
      return new Promise((resolve) => {
        let count = 0;
        for (let i = 0; i < size; i++) {
          benchFn(pool, i).finally(() => {
            count++;
            if (count >= size) {
              resolve(undefined);
            }
          });
        }
      });
    }
    bench.add(name, async () => {
      await run(pool, concurrency);
    }, {
      beforeAll: async () => {
        pool = await createPool({ poolSize });
        await run(pool, poolSize * 2);
      },
      afterAll: async () => {
        await closePool(pool);
      },
    });
  };
}
