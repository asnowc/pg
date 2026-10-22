import type { ConcurrencyBenchResultWithCPUAndMemory, ConcurrencyBenchSample } from "../types/bench_result.ts";

export type IntervalMetric = "concurrency" | "qps" | "cpu" | "rss" | "memoryExtended" | "jsHeap";

/** 正式测量窗口内的资源时间序列，每个下标对应一个快照区间。 */
export type IntervalSamples = Record<IntervalMetric, number[]> & {
  /** 区间右端点相对正式测量开始的秒数 */
  seconds: number[];
  /** 区间长度（秒） */
  intervalSeconds: number[];
};

/** 延迟仅统计成功调用，单位毫秒；无成功样本时各统计量为 null。 */
export type LatencyStatistics = {
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
  /** 95% Student-t 均值置信区间的相对半宽（%）；不足两项或均值为零时为 null。 */
  rme: number | null;
  successCount: number;
  errorCount: number;
};

export type StageAnalysis = {
  index: number;
  concurrency: number;
  startSeconds: number;
  endSeconds: number;
  /** 阶段内按区间时长加权的平均值；无快照覆盖时为 null。 */
  averages: Record<IntervalMetric, number | null>;
  /** 该阶段发起的请求的延迟，包含在后续阶段或排空期间完成的请求。 */
  latency: LatencyStatistics;
};

export type AnalyzedSampleGroup = {
  name: string;
  run: ConcurrencyBenchResultWithCPUAndMemory;
  intervalSample: IntervalSamples;
  stages: StageAnalysis[];
  /** 全部正式请求的延迟 */
  latency: LatencyStatistics;
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

function latencyStatistics(latency: number[], errorCount: number): LatencyStatistics {
  latency.sort((a, b) => a - b);
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
    successCount: count,
    errorCount,
  };
}

/** 返回第一个大于 value 的下标；values 需升序。 */
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

/** 按请求 id 将样本归入发起阶段，同时记录每个阶段最早的发起时间。 */
class StageBuckets {
  readonly latency: number[][];
  readonly errorCount: number[];
  readonly firstStart: number[];
  private readonly startIndices: number[];

  constructor(private readonly run: ConcurrencyBenchResultWithCPUAndMemory) {
    const count = run.stageSamples.length;
    this.startIndices = run.stageSamples.map((stage) => stage.startIndex);
    this.latency = Array.from({ length: count }, () => []);
    this.errorCount = new Array<number>(count).fill(0);
    this.firstStart = new Array<number>(count).fill(Infinity);
  }

  private stageOf(sample: ConcurrencyBenchSample) {
    const index = upperBound(this.startIndices, sample[2]) - 1;
    if (index < 0 || sample[2] >= this.run.stageSamples[index].endIndex) return -1;
    this.firstStart[index] = Math.min(this.firstStart[index], sample[0]);
    return index;
  }

  addSuccess(sample: ConcurrencyBenchSample) {
    const index = this.stageOf(sample);
    if (index >= 0) this.latency[index].push(sample[1] - sample[0]);
  }

  addFailure(sample: ConcurrencyBenchSample) {
    const index = this.stageOf(sample);
    if (index >= 0) this.errorCount[index]++;
  }

  /**
   * 阶段起点取该阶段首个请求的发起时间；降低并发的阶段不会立即发起请求，
   * 因此起点略晚于真实切换时间。首阶段使用 run.startTime，空阶段借用下一阶段的起点。
   */
  stageTimes(): number[] {
    const times = new Array<number>(this.firstStart.length);
    let next = this.run.endTime;
    for (let index = times.length - 1; index >= 0; index--) {
      if (Number.isFinite(this.firstStart[index])) next = this.firstStart[index];
      times[index] = index === 0 ? this.run.startTime : next;
    }
    return times;
  }
}

/**
 * 从 CPU/内存快照构建正式测量窗口内的时间序列。QPS 按成功请求的完成时间落入的快照区间统计。
 */
function buildIntervalSamples(
  run: ConcurrencyBenchResultWithCPUAndMemory,
  successSamples: ConcurrencyBenchSample[],
  stageTimes: number[],
): IntervalSamples {
  const snapshots = run.intervalSampleData;
  const timestamps = snapshots.map((snapshot) => snapshot.timestamp);
  const completions = new Array<number>(Math.max(0, snapshots.length - 1)).fill(0);
  for (const sample of successSamples) {
    const index = upperBound(timestamps, sample[1]) - 1;
    if (index >= 0 && index < completions.length) completions[index]++;
  }
  const result: IntervalSamples = {
    seconds: [],
    intervalSeconds: [],
    concurrency: [],
    qps: [],
    cpu: [],
    rss: [],
    memoryExtended: [],
    jsHeap: [],
  };
  for (let i = 1; i < snapshots.length; i++) {
    const previous = snapshots[i - 1];
    const current = snapshots[i];
    if (current.timestamp <= run.startTime || previous.timestamp >= run.endTime) continue;
    const ms = current.timestamp - previous.timestamp;
    const stage = upperBound(stageTimes, Math.max(previous.timestamp, run.startTime)) - 1;
    result.seconds.push((current.timestamp - run.startTime) / 1000);
    result.intervalSeconds.push(ms / 1000);
    result.concurrency.push(run.stageSamples[stage].concurrency);
    result.qps.push(completions[i - 1] / (ms / 1000));
    result.cpu.push((current.user + current.system - previous.user - previous.system) / (ms * 10));
    result.rss.push(current.rss / 1024 ** 2);
    result.memoryExtended.push(current.external / 1024 ** 2);
    result.jsHeap.push(current.heapUsed / 1024 ** 2);
  }
  return result;
}

/** [start, end] 秒窗口内按区间重叠时长加权的平均值。 */
function weightedAverage(samples: IntervalSamples, metric: IntervalMetric, start: number, end: number) {
  let weighted = 0;
  let elapsed = 0;
  for (let i = 0; i < samples.seconds.length; i++) {
    const right = samples.seconds[i];
    const left = right - samples.intervalSeconds[i];
    const overlap = Math.max(0, Math.min(end, right) - Math.max(start, left));
    weighted += samples[metric][i] * overlap;
    elapsed += overlap;
  }
  return elapsed > 0 ? weighted / elapsed : null;
}

/**
 * 分析一次并发基准：按阶段的请求 id 范围归组延迟（包含排空期间完成的请求），
 * 资源曲线与阶段平均值只覆盖 run.startTime 到 run.endTime 的正式测量窗口。
 */
export function analyzeSampleGroup(input: {
  run: ConcurrencyBenchResultWithCPUAndMemory;
  successSamples: ConcurrencyBenchSample[];
  failedSamples: ConcurrencyBenchSample[];
  /** 报告中展示的名称，默认 run.name */
  name?: string;
}): AnalyzedSampleGroup {
  const { run, successSamples, failedSamples, name = run.name } = input;

  const buckets = new StageBuckets(run);
  for (const sample of successSamples) buckets.addSuccess(sample);
  for (const sample of failedSamples) buckets.addFailure(sample);
  const stageTimes = buckets.stageTimes();

  const intervalSample = buildIntervalSamples(run, successSamples, stageTimes);

  const stages = run.stageSamples.map((stage, index): StageAnalysis => {
    const startSeconds = (stageTimes[index] - run.startTime) / 1000;
    const endSeconds = ((stageTimes[index + 1] ?? run.endTime) - run.startTime) / 1000;
    const latency = latencyStatistics(buckets.latency[index], buckets.errorCount[index]);
    const duration = endSeconds - startSeconds;
    return {
      index,
      concurrency: stage.concurrency,
      startSeconds,
      endSeconds,
      latency,
      averages: {
        concurrency: stage.concurrency,
        qps: duration > 0 ? latency.successCount / duration : null,
        cpu: weightedAverage(intervalSample, "cpu", startSeconds, endSeconds),
        rss: weightedAverage(intervalSample, "rss", startSeconds, endSeconds),
        memoryExtended: weightedAverage(intervalSample, "memoryExtended", startSeconds, endSeconds),
        jsHeap: weightedAverage(intervalSample, "jsHeap", startSeconds, endSeconds),
      },
    };
  });

  const errorCount = buckets.errorCount.reduce((sum, value) => sum + value, 0);
  return {
    name,
    run,
    intervalSample,
    stages,
    latency: latencyStatistics(buckets.latency.flat(), errorCount),
  };
}
