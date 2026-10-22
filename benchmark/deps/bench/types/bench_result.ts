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
  /** 总错误样本数 */
  totalFailedSamples: number;
  /** 总成功样本数 */
  totalSuccessSamples: number;
  /** 采样开始时间，单位为毫秒，使用 performance.now() 获取 */
  startTime: number;
  /** 采样结束时间，单位为毫秒，使用 performance.now() 获取 */
  endTime: number;
  /** 排空完成时间，单位为毫秒，使用 performance.now() 获取 */
  clearTime: number;
};
export type ConcurrencyBenchResultWithCPUAndMemory = ConcurrencyBenchResult & {
  intervalSampleData: (NodeJS.CpuUsage & NodeJS.MemoryUsage & {
    timestamp: number;
  })[];
};
/** 时间为 performance.now() 的毫秒值；id 是任务内唯一的安全整数。 */
export type ConcurrencyBenchSample = [startTime: number, endTime: number, id: number];
