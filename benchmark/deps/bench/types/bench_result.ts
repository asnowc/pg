export type ConcurrencyBenchResult = {
  name: string;
  warmup: {
    /** 预热迭代次数 */
    iterations: number;
    /** 预热持续时间 */
    duration: number;
  };
  /** 并发数变更采样 */
  stageSamples: {
    concurrency: number;
    /** 发起请求的 id 范围 [startIndex, endIndex)，预热 id 不在范围内。 */
    startIndex: number;
    endIndex: number;
  }[];
};
export type ConcurrencyBenchResultWithCPUAndMemory = ConcurrencyBenchResult & {
  intervalSampleData: (NodeJS.CpuUsage & NodeJS.MemoryUsage & {
    timestamp: number;
  })[];
  inputInterval: number;
};
