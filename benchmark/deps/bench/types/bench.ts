export type BenchInput = {
  name?: string;
  /** 最小迭代次数 */
  iterations?: number;
  /** 最少迭代总时长 */
  duration?: number;

  /** 最小预热次数。默认 0. */
  warmup?: number;
  /** 最少预热持续时间，默认 0 */
  warmupDuration?: number;
};

export type BenchConfig = BenchInput;
export type ConcurrencyBenchInput = BenchInput & {
  /** 初始并发数 */
  concurrency: number;
};

export type ConcurrencyBenchConfig = BenchConfig & ConcurrencyBenchInput;
