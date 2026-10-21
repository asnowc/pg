import { ConcurrencyBenchResultWithCPUAndMemory } from "../types/bench_result.ts";
import { CommonBenchSampleGroup } from "../types/sample.ts";

export declare function analyzeSampleGroup<T>(
  input: {
    sampleGroup: CommonBenchSampleGroup<T>;
    intervalSamples: ConcurrencyBenchResultWithCPUAndMemory;
    /** 数据分组。返回 undefined 表示丢弃样本 */
    groupBy?: (sample: T) => string | undefined;
  },
): {
  intervalSample: IntervalSamples;
  resultGroup: Map<string, AnalyzeSampleGroupResult>;
};
export type IntervalSamples = {
  rss: number[];
  cpu: number[];
  memoryExtended: number[];
  jsHeap: number[];
  qps: number[];
  concurrency: number[];
};
export type AnalyzeSampleGroupResult = {
  p50: number;
  p75: number;
  p90: number;
  p95: number;
  p99: number;
  p995: number;
  p999: number;
  min: number;
  max: number;

  /** 样本均值 */
  mean: number;
  /** 样本相对误差 */
  rme: number;
  /** 样本数量。等于 errorCount + successCount */
  sampleCount: number;

  /** 执行失败次数 */
  errorCount: number;
  /** 执行成功次数 */
  successCount: number;
};
