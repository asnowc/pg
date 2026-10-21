export type CommonBenchSampleGroup<T> = {
  /** 样本组名称 */
  name: string;
  startTime: number;
  endTime: number;
  samples: T[];
  sampleCount: number;
};

export type ConcurrencyBenchSampleGroup = CommonBenchSampleGroup<ConcurrencyBenchSample>;
export type ConcurrencyBenchSample = [startTime: number, endTime: number, success: boolean, id: number];
