export type CommonBenchSampleGroup<T> = {
  /** 样本组名称 */
  name: string;
  startTime: number;
  endTime: number;
  samples: T[];
  sampleCount: number;
};

export type ConcurrencyBenchSampleGroup = CommonBenchSampleGroup<ConcurrencyBenchSample>;
/** 时间为 performance.now() 的毫秒值；id 是任务内唯一的安全整数。 */
export type ConcurrencyBenchSample = [startTime: number, endTime: number, success: boolean, id: number];
