export type BenchResult = {
  /** 实际迭代次数 */
  iterations: number;
  /** 实际迭代总时长 */
  duration: number;
  /** 实际预热次数 */
  warmup: number;
  /** 实际预热持续时间 */
  warmupDuration: number;
};

export type ConcurrencyBenchResult = BenchResult & {
  /** 并发数变更采样 */
  concurrencySamples: { value: number; startTime: number }[];
};
