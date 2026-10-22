import type {
  ConcurrencyBenchResult,
  ConcurrencyBenchResultWithCPUAndMemory,
  ConcurrencyBenchSample,
} from "./types/bench_result.ts";
import { cpuUsage, memoryUsage } from "node:process";
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
   * 正式请求按成功或失败分别向两个收集器投递 `[startTime, endTime, id]`，
   * 时间单位为毫秒，id 在整个任务内递增。查询失败不终止测量，也不会使返回的 Promise 拒绝。
   * CPU/内存快照按 intervalSampleCPUAndMemory 指定的毫秒间隔采集，包含预热和最终排空；
   * 不补采阶段边界，短任务可能没有快照。
   *
   * 当前收集器异常仅记录日志并将目标并发设为 0，不会作为返回 Promise 的拒绝原因；
   * 后续档位仍可能恢复派发，排空期间的收集器异常可能导致等待无法完成。
   * 持续立即兑现或拒绝的 fn 可能使阶段计时器饥饿。
   * 调用方负责连接释放以及文件收集器的最终刷新和关闭。
   * @since 0.2.5
   */
  async runWidthCpuAndMemory(options: {
    fn: () => Promise<void>;
    intervalSampleCPUAndMemory: number;
    collectorSuccess: BenchSampleCollector;
    collectorFailed: BenchSampleCollector;
  }): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
    const { fn, intervalSampleCPUAndMemory, collectorSuccess, collectorFailed } = options;

    const runner = new ConcurrencyRunner(fn);

    const intervalSampleData: ConcurrencyBenchResultWithCPUAndMemory["intervalSampleData"] = [];

    const timer = setInterval(() => {
      intervalSampleData.push({ ...cpuUsage(), ...memoryUsage(), timestamp: performance.now() });
    }, intervalSampleCPUAndMemory);
    try {
      const result = await runBench(runner, this.settings, {
        onWarmupEnd: async () => {
          console.log("run start");
        },
        onRunEnd: async () => {
          console.log("waiting for task to clear");
        },
        onSampleFailed: (value) => collectorFailed.push(value),
        onSampleSuccess: (value) => collectorSuccess.push(value),
      });
      console.log("run complete");
      return { ...result, intervalSampleData };
    } finally {
      clearInterval(timer);
    }
  }
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
  if (onSampleSuccess) {
    runner.onSampleSuccess = (data) => {
      if (data[2] < runStartIndex) return;
      onSampleSuccess(data);
    };
  }
  if (onSampleFailed) {
    runner.onSampleFailed = (data) => {
      if (data[2] < runStartIndex) return;
      onSampleFailed(data);
    };
  }
  const startTime = performance.now();
  let i = 0;
  let stage = stages[i];
  const stageSamples: ConcurrencyBenchResult["stageSamples"] = [];
  while (stage) {
    const concurrency = stage.value;
    const startIndex = runner.nextRequestIndex;
    runner.updateConcurrency(concurrency);
    await new Promise<void>((resolve) => setTimeout(resolve, stage.duration));
    const endIndex = runner.nextRequestIndex;
    stageSamples.push({ concurrency, startIndex, endIndex });
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
  onSampleFailed?: (sample: ConcurrencyBenchSample) => void;
  onSampleSuccess?: (sample: ConcurrencyBenchSample) => void;
  onWarmupEnd?: () => Promise<void>;
  onRunEnd?: () => Promise<void>;
};

class Event {
  private listeners: Map<string, Map<(...args: any[]) => void, boolean>> = new Map();
  private getEventListeners(name: string) {
    let listeners = this.listeners.get(name);
    if (!listeners) {
      listeners = new Map();
      this.listeners.set(name, listeners);
    }
    return listeners;
  }
  on(name: string, callback: (...args: any[]) => void) {
    this.getEventListeners(name).set(callback, false);
  }
  once(name: string, callback: (...args: any[]) => void) {
    this.getEventListeners(name).set(callback, true);
  }
  off(name: string, callback: (...args: any[]) => void) {
    this.listeners.get(name)?.delete(callback);
  }
  emit(name: string, ...args: any[]) {
    const listeners = this.listeners.get(name);
    if (!listeners) return;
    listeners.forEach((once, callback) => {
      callback(...args);
      if (once) {
        listeners.delete(callback);
      }
    });
  }
}
class ConcurrencyRunner extends Event {
  /** 预期的并发数 */
  targetConcurrency = 0;
  /** 当前实际的并发数 */
  currentConcurrency = 0;
  /** 下一个请求的索引 */
  nextRequestIndex = 0;
  /** 成功的请求数 */
  successCount = 0;
  /** 失败的请求数 */
  errorCount = 0;

  /** 成功的采样回调 */
  onSampleSuccess(data: ConcurrencyBenchSample) {}
  /** 失败的采样回调 */
  onSampleFailed(data: ConcurrencyBenchSample, error: unknown) {}

  private onClear() {
    this.emit("clear");
  }
  waitClear() {
    if (this.currentConcurrency === 0) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.once("clear", resolve));
  }

  constructor(private fn: () => Promise<void>) {
    super();
  }

  private onRequestError(data: ConcurrencyBenchSample, error: unknown) {
    const end = performance.now();
    this.errorCount++;
    this.currentConcurrency--;
    data[1] = end;
    this.onSampleFailed(data, error);
    this.onReduce(end);
  }
  private onRequestSuccess(data: ConcurrencyBenchSample) {
    const end = performance.now();
    this.successCount++;
    this.currentConcurrency--;
    data[1] = end;
    this.onSampleSuccess(data);

    this.onReduce(end);
  }
  private onReduce(end: number) {
    if (this.currentConcurrency < this.targetConcurrency) {
      this.requestNext(end);
    } else if (this.currentConcurrency === 0) {
      this.onClear();
    }
  }
  updateConcurrency(value: number) {
    this.targetConcurrency = value;
    const start = performance.now();
    while (this.currentConcurrency < this.targetConcurrency) {
      this.requestNext(start);
    }
  }
  requestNext(start: number) {
    this.currentConcurrency++;
    const i = this.nextRequestIndex++;
    const data: ConcurrencyBenchSample = [start, 0, i];
    this.callBenchFn(data, this.fn).catch((e) => {
      console.error("Unhandled error in callBenchFn", e);
      this.targetConcurrency = 0;
    });
  }
  private callBenchFn(data: ConcurrencyBenchSample, fn: () => Promise<void>) {
    return new Promise<void>((resolve) => resolve(fn())).then(
      () => this.onRequestSuccess(data),
      (e) => this.onRequestError(data, e),
    );
  }
}

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
