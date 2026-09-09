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
export type AddPoolBenchOptions<T> = PoolInfo<T> & {
  benchFn: (data: T) => Promise<void>;
};
type AddPoolBench = <T>(info: PoolInfo<T>, benchFn: (data: T) => Promise<void>) => void;

export function createPoolBench(bench: Bench, options: CreatePoolBenchOptions): AddPoolBench {
  const { concurrency, poolSize } = options;
  return function <T>(info: PoolInfo<T>, benchFn: (data: T) => Promise<void>) {
    const { name, createPool, closePool } = info;
    let pool: T;
    bench.add(name, async () => {
      const promises: Promise<void>[] = new Array<Promise<void>>(concurrency);
      for (let i = 0; i < concurrency; i++) {
        promises[i] = benchFn(pool);
      }
      await Promise.all(promises);
    }, {
      beforeAll: async () => {
        pool = await createPool({ poolSize });
      },
      afterAll: async () => {
        await closePool(pool);
      },
    });
  };
}
