import type { ConcurrencyBenchResultWithCPUAndMemory } from "../types/bench_result.ts";
import type { CommonBenchSampleGroup, ConcurrencyBenchSample } from "../types/sample.ts";

export type IntervalMetric = "rss" | "cpu" | "memoryExtended" | "jsHeap" | "qps" | "concurrency";

export type StageAnalysis = {
  index: number;
  concurrency: number;
  startSeconds: number;
  endSeconds: number;
  averages: Record<IntervalMetric, number | null>;
  statistics: AnalyzeSampleGroupResult;
};

export type IntervalSamples = Record<IntervalMetric, number[]> & {
  seconds: number[];
  intervalSeconds: number[];
  stages: StageAnalysis[];
};

/** 延迟仅统计成功且在正式窗口内完成的调用，单位毫秒。 */
export type AnalyzeSampleGroupResult = {
  p50: number | null;
  p75: number | null;
  p90: number | null;
  p95: number | null;
  p99: number | null;
  p995: number | null;
  p999: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** 95% Student-t 均值置信区间的相对半宽（%）；不足两项或均值为零时不可用。 */
  rme: number | null;
  sampleCount: number;
  errorCount: number;
  successCount: number;
};

export type AnalyzedSampleGroup = {
  name: string;
  run: ConcurrencyBenchResultWithCPUAndMemory;
  intervalSample: IntervalSamples;
  resultGroup: Map<string, AnalyzeSampleGroupResult>;
};

const critical95 = [
  12.706205,
  4.302653,
  3.182446,
  2.776445,
  2.570582,
  2.446912,
  2.364624,
  2.306004,
  2.262157,
  2.228139,
  2.200985,
  2.178813,
  2.160369,
  2.144787,
  2.13145,
  2.119905,
  2.109816,
  2.100922,
  2.093024,
  2.085963,
  2.079614,
  2.073873,
  2.068658,
  2.063899,
  2.059539,
  2.055529,
  2.051831,
  2.048407,
  2.04523,
  2.042272,
];

function t95(df: number) {
  if (df <= critical95.length) return critical95[df - 1];
  const z = 1.959963984540054;
  return z + (z ** 3 + z) / (4 * df) + (5 * z ** 5 + 16 * z ** 3 + 3 * z) / (96 * df ** 2) +
    (3 * z ** 7 + 19 * z ** 5 + 17 * z ** 3 - 15 * z) / (384 * df ** 3);
}

function statistics(samples: ConcurrencyBenchSample[]): AnalyzeSampleGroupResult {
  const latency = samples.filter((sample) => sample[2]).map((sample) => sample[1] - sample[0]).sort((a, b) => a - b);
  const count = latency.length;
  const mean = count ? latency.reduce((sum, value) => sum + value, 0) / count : null;
  const percentile = (p: number) => count ? latency[Math.ceil(count * p) - 1] : null;
  let rme: number | null = null;
  if (count > 1 && mean !== null && mean > 0) {
    const variance = latency.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1);
    rme = t95(count - 1) * Math.sqrt(variance / count) / mean * 100;
  }
  return {
    p50: percentile(0.5),
    p75: percentile(0.75),
    p90: percentile(0.9),
    p95: percentile(0.95),
    p99: percentile(0.99),
    p995: percentile(0.995),
    p999: percentile(0.999),
    min: latency[0] ?? null,
    max: latency.at(-1) ?? null,
    mean,
    rme,
    sampleCount: samples.length,
    successCount: count,
    errorCount: samples.length - count,
  };
}

function upperBound(values: number[], value: number) {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle] <= value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * 按阶段的请求 id 范围归组，延迟包含排空结果；资源曲线仅覆盖正式测量。
 */
export function analyzeSampleGroup<T extends ConcurrencyBenchSample>(input: {
  sampleGroup: CommonBenchSampleGroup<T>;
  intervalSamples: ConcurrencyBenchResultWithCPUAndMemory;
  /** 返回 undefined 的样本不参与延迟、成功/失败数和 QPS。 */
  groupBy?: (sample: T) => string | undefined;
}): AnalyzedSampleGroup {
  const { sampleGroup, intervalSamples: run, groupBy } = input;
  const { startTime, endTime } = sampleGroup;
  const snapshots = run.intervalSampleData;
  const stageIndices = run.stageSamples.map((stage) => stage.startIndex);
  const boundaries = new Set(stageIndices);
  const requestStarts = new Map<number, number>();
  for (const sample of sampleGroup.samples) {
    if (boundaries.has(sample[3])) requestStarts.set(sample[3], sample[0]);
  }
  const stageTimes = new Array<number>(stageIndices.length);
  let nextTime = endTime;
  for (let index = stageIndices.length - 1; index >= 0; index--) {
    const stage = run.stageSamples[index];
    // An empty request range has no reconstructible start time.
    if (stage.startIndex < stage.endIndex) nextTime = requestStarts.get(stage.startIndex) ?? nextTime;
    stageTimes[index] = index === 0 ? startTime : nextTime;
  }
  const times = snapshots.map((sample) => sample.timestamp);
  const qpsCounts = new Array<number>(Math.max(0, times.length - 1)).fill(0);
  const groups = new Map<string, ConcurrencyBenchSample[]>();
  const stageSamples = stageTimes.map(() => [] as ConcurrencyBenchSample[]);
  if (!groupBy) groups.set(sampleGroup.name, []);
  for (const sample of sampleGroup.samples) {
    const stageIndex = upperBound(stageIndices, sample[3]) - 1;
    if (stageIndex < 0 || sample[3] >= run.stageSamples[stageIndex].endIndex) continue;
    const key = groupBy ? groupBy(sample) : sampleGroup.name;
    if (key === undefined) continue;
    let group = groups.get(key);
    if (!group) groups.set(key, group = []);
    group.push(sample);
    stageSamples[stageIndex].push(sample);
    const intervalIndex = upperBound(times, sample[1]) - 1;
    if (sample[2] && intervalIndex >= 0 && intervalIndex < qpsCounts.length) qpsCounts[intervalIndex]++;
  }
  const intervalSample: IntervalSamples = {
    seconds: [],
    intervalSeconds: [],
    cpu: [],
    rss: [],
    jsHeap: [],
    memoryExtended: [],
    qps: [],
    concurrency: [],
    stages: [],
  };
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    const ms = current.timestamp - previous.timestamp;
    const stage = upperBound(stageTimes, previous.timestamp) - 1;
    intervalSample.seconds.push((current.timestamp - startTime) / 1000);
    intervalSample.intervalSeconds.push(ms / 1000);
    intervalSample.cpu.push((current.user + current.system - previous.user - previous.system) / (ms * 10));
    intervalSample.rss.push(current.rss / 1024 ** 2);
    intervalSample.jsHeap.push(current.heapUsed / 1024 ** 2);
    intervalSample.memoryExtended.push(current.external / 1024 ** 2);
    intervalSample.qps.push(qpsCounts[i - 1] / (ms / 1000));
    intervalSample.concurrency.push(stage >= 0 ? run.stageSamples[stage].concurrency : 0);
  }
  const average = (key: IntervalMetric, start: number, end: number) => {
    let weighted = 0;
    let elapsed = 0;
    for (let i = 0; i < intervalSample.seconds.length; i++) {
      const right = intervalSample.seconds[i];
      const left = right - intervalSample.intervalSeconds[i];
      const overlap = Math.max(0, Math.min(end, right) - Math.max(start, left));
      weighted += intervalSample[key][i] * overlap;
      elapsed += overlap;
    }
    return elapsed > 0 ? weighted / elapsed : null;
  };
  intervalSample.stages = run.stageSamples.map((stage, index): StageAnalysis => {
    const startSeconds = (stageTimes[index] - startTime) / 1000;
    const endSeconds = ((stageTimes[index + 1] ?? endTime) - startTime) / 1000;
    const stats = statistics(stageSamples[index]);
    return {
      index,
      concurrency: stage.concurrency,
      startSeconds,
      endSeconds,
      statistics: stats,
      averages: {
        cpu: average("cpu", startSeconds, endSeconds),
        rss: average("rss", startSeconds, endSeconds),
        jsHeap: average("jsHeap", startSeconds, endSeconds),
        memoryExtended: average("memoryExtended", startSeconds, endSeconds),
        concurrency: stage.concurrency,
        qps: endSeconds > startSeconds ? stats.successCount / (endSeconds - startSeconds) : null,
      },
    };
  });
  return {
    name: sampleGroup.name,
    run,
    intervalSample,
    resultGroup: new Map([...groups].map(([name, samples]) => [name, statistics(samples)])),
  };
}
