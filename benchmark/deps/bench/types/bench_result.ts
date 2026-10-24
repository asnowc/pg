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
    /** 该档开始时间，单位为毫秒，使用 performance.now() 获取。该档结束于下一档开始或 endTime。 */
    startTime: number;
  }[];
  /** 总错误样本数 */
  totalFailedSamples: number;
  /** 总成功样本数 */
  totalSuccessSamples: number;
  /** 采样开始时间，单位为毫秒，使用 performance.now() 获取。等于 stageSamples[0].startTime  */
  startTime: number;
  /** 采样结束时间，单位为毫秒，使用 performance.now() 获取 */
  endTime: number;
  /** 排空完成时间，单位为毫秒，使用 performance.now() 获取 */
  clearTime: number;
};
export type ConcurrencyBenchResultWithCPUAndMemory = ConcurrencyBenchResult & {
  snapshot: (NodeJS.CpuUsage & NodeJS.MemoryUsage & OperationRunnerContext & {
    timestamp: number;
  })[];
};
/** 时间为 performance.now() 的毫秒值。 */
export type ConcurrencyBenchSample = [startTime: number, endTime: number];

export interface OperationRunnerContext {
  /** 当前实际的并发数 */
  currentConcurrency: number;
  /** 下一个操作的索引 */
  nextOperationIndex: number;
  /** 成功的操作数 */
  successCount: number;
  /** 失败的操作数 */
  errorCount: number;
}
