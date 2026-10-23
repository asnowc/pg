import type {
  ConcurrencyBenchResult,
  ConcurrencyBenchResultWithCPUAndMemory,
  ConcurrencyBenchSample,
} from "./types/bench_result.ts";
import { cpuUsage, memoryUsage } from "node:process";
import { ConcurrencyRunner } from "./utils/ConcurrencyRunner.ts";
export type ConcurrencyStage = { value: number; duration: number };

export type BenchInput = {
  name?: string;
  /** 每档测量毫秒数，默认 3000。 */
  duration?: number;
  /** 预热毫秒数，默认 0；仅使用第一档并发。 */
  warmupDuration?: number;
  /** 保留输入顺序和重复档位。 */
  concurrency: number | number[] | ConcurrencyStage[];
};

export type ConcurrencyBenchConfig = BenchInput;

export interface BenchSampleCollector {
  push(sample: ConcurrencyBenchSample): void;
}

export class ConcurrencyBench {
  constructor(config: ConcurrencyBenchConfig) {
    this.settings = normalize(config);
  }

  private readonly settings: ReturnType<typeof normalize>;

  /**
   * 按配置顺序测量目标并发，正常情况下在最后一档停止补发、等待在途调用完成后返回。
   * 预热只使用第一档并发，结束时不排空；预热请求的结果不会传给收集器。
   *
   * 正式请求按成功或失败分别向两个收集器投递 `[startTime, endTime]`，
   * 时间单位为毫秒。查询失败不终止测量，也不会使返回的 Promise 拒绝。
   * CPU/内存快照按 intervalSampleCPUAndMemory 指定的毫秒间隔采集，包含预热和最终排空；
   * 采集开始、正式测量开始和每档结束时会立即补采一次并重新对齐定时器。
   *
   * 当前收集器异常仅记录日志并将目标并发设为 0，不会作为返回 Promise 的拒绝原因；
   * 后续档位仍可能恢复派发，排空期间的收集器异常可能导致等待无法完成。
   * 持续立即兑现或拒绝的 fn 可能使阶段计时器饥饿。
   * 调用方负责连接释放以及文件收集器的最终刷新和关闭。
   * @since 0.2.5
   */
  async runWidthCpuAndMemory(options: {
    fn: (index: number) => Promise<void>;
    intervalSampleCPUAndMemory: number;
    collectorSuccess: BenchSampleCollector;
    collectorFailed: BenchSampleCollector;
  }): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
    const { fn, intervalSampleCPUAndMemory, collectorSuccess, collectorFailed } = options;

    const runner = new ConcurrencyRunner(fn);

    const intervalSampleData: ConcurrencyBenchResultWithCPUAndMemory["snapshot"] = [];

    const snapshot = () => {
      intervalSampleData.push({
        ...cpuUsage(),
        ...memoryUsage(),
        timestamp: performance.now(),
        currentConcurrency: runner.currentConcurrency,
        nextRequestIndex: runner.nextRequestIndex,
        successCount: runner.successCount,
        errorCount: runner.errorCount,
      });
    };
    const timer = setInterval(snapshot, intervalSampleCPUAndMemory);

    let warmupEndRequestIndex: number = 0;
    try {
      const result = await runBench(runner, this.settings, {
        onWarmupEnd: () => {
          warmupEndRequestIndex = runner.nextRequestIndex;
          console.log("run start");
        },
        onStageChange: snapshot,
        onRunEnd: () => {
          snapshot();
          console.log("waiting for task to clear");
        },
        onSampleFailed: (value, index) => {
          if (index < warmupEndRequestIndex) return;
          collectorFailed.push(value);
        },
        onSampleSuccess: (value, index) => {
          if (index < warmupEndRequestIndex) return;
          collectorSuccess.push(value);
        },
      });
      console.log("run complete");
      return { ...result, snapshot: intervalSampleData };
    } finally {
      clearInterval(timer);
    }
  }
}

export interface IntervalBenchRunner {
  (fn: (index: number) => Promise<void>): Promise<void>;
}
async function runBench(runner: ConcurrencyRunner, settings: BenchSetting, options: RunOptions) {
  const { onWarmupEnd, onSampleFailed, onSampleSuccess } = options;

  let warmupResult: { iterations: number; duration: number };
  if (settings.warmupDuration <= 0 || settings.warmupConcurrency <= 0) {
    warmupResult = { iterations: 0, duration: 0 };
  } else {
    const { warmupDuration, warmupConcurrency } = settings;
    const startTime = performance.now();
    runner.updateConcurrency(warmupConcurrency);
    await new Promise<void>((resolve) => setTimeout(resolve, warmupDuration));
    const endTime = performance.now();
    warmupResult = {
      iterations: runner.nextRequestIndex,
      duration: endTime - startTime,
    };
  }
  if (onWarmupEnd) await onWarmupEnd();

  const { stages } = settings;
  const runStartIndex = runner.nextRequestIndex;
  const startTime = performance.now();
  // 预热发起的请求开始时间早于 startTime，不传给收集器
  if (onSampleSuccess) {
    runner.onSampleSuccess = (data, requestIndex) => {
      if (requestIndex < runStartIndex) return;
      onSampleSuccess(data, requestIndex);
    };
  }
  if (onSampleFailed) {
    runner.onSampleFailed = (data, requestIndex) => {
      if (requestIndex < runStartIndex) return;
      onSampleFailed(data, requestIndex);
    };
  }
  let i = 0;
  let stage = stages[i];
  const stageSamples: ConcurrencyBenchResult["stageSamples"] = [];
  while (stage) {
    const concurrency = stage.value;
    options.onStageChange?.();
    stageSamples.push({ concurrency, startTime: i === 0 ? startTime : performance.now() });
    runner.updateConcurrency(concurrency);
    await new Promise<void>((resolve) => setTimeout(resolve, stage.duration));
    i++;
    stage = stages[i];
  }
  runner.targetConcurrency = 0;
  const endTime = performance.now();
  await runner.waitClear();
  const clearTime = performance.now();
  return {
    stageSamples,
    warmup: warmupResult,
    totalFailedSamples: runner.errorCount,
    totalSuccessSamples: runner.successCount,

    startTime,
    endTime,
    clearTime,
    name: settings.name,
  };
}
type RunOptions = {
  onSampleFailed?: (sample: ConcurrencyBenchSample, index: number) => void;
  onSampleSuccess?: (sample: ConcurrencyBenchSample, index: number) => void;
  onWarmupEnd?: () => Promise<void> | void;
  /** 每档测量时长结束、切换下一档之前同步调用。 */
  onStageChange?: () => void;
  onRunEnd?: () => Promise<void> | void;
};

function normalize(input: BenchInput): BenchSetting {
  const { duration = 3000, warmupDuration = 0 } = input;
  const entries = typeof input.concurrency === "number" ? [input.concurrency] : input.concurrency;
  if (!entries.length) throw new RangeError("concurrency must not be empty");
  const stages = entries.map((entry) => typeof entry === "number" ? { value: entry, duration } : { ...entry });
  for (const stage of stages) {
    if (stage.value <= 0) {
      throw new RangeError(`concurrency must be finite and positive`);
    }
  }
  return { name: input.name ?? "", stages, warmupDuration, warmupConcurrency: stages[0].value };
}
type BenchSetting = {
  name: string;
  warmupDuration: number;
  warmupConcurrency: number;
  stages: ConcurrencyStage[];
};
