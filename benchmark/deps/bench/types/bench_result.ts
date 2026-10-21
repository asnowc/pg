export type ConcurrencyBenchResult = {
  /** 开始时间，单位毫秒，不包括预热时间 */
  startTime: number;
  /** 结束时间，单位毫秒  */
  endTime: number;
  /** 实际迭代次数 */
  iterations: number;
  /** 实际预热次数 */
  warmup: number;
  /** 实际预热持续时间 */
  warmupDuration: number;
  /** 并发数变更采样 */
  concurrencySamples: { value: number; startTime: number }[];
};
export type ConcurrencyBenchResultWithCPUAndMemory = ConcurrencyBenchResult & {
  intervalSampleData: (NodeJS.CpuUsage & NodeJS.MemoryUsage & {
    timestamp: number;
  })[];
  inputInterval: number;
};
