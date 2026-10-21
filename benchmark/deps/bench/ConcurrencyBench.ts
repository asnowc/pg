import type { ConcurrencyBenchResult, ConcurrencyBenchResultWithCPUAndMemory } from "./types/bench_result.ts";
import type { ConcurrencyBenchSample } from "./types/sample.ts";
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
  /** 全任务允许失败次数，默认 0；严格超过后停止补发，排空继续计数。 */
  maxFailures?: number;
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
  createTask(fn: () => Promise<void>): ConcurrencyBenchTask {
    return new ConcurrencyBenchTask(this.settings, fn);
  }

  /**
   * 排空完成后返回；查询失败超限或收集器异常在排空后直接抛出原始错误。
   * 文件收集器的最终刷新/关闭由调用方负责。
   */
  async runWidthCpuAndMemory(options: {
    fn: () => Promise<void>;
    intervalSampleCPUAndMemory: number;
    collector: BenchSampleCollector;
  }): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
    const { fn, intervalSampleCPUAndMemory, collector } = options;
    positive(intervalSampleCPUAndMemory, "intervalSampleCPUAndMemory");
    const task = this.createTask(fn);
    console.log("creating task for", this.settings.name);
    const intervalSampleData: ConcurrencyBenchResultWithCPUAndMemory["intervalSampleData"] = [];

    const timer = setInterval(() => {
      intervalSampleData.push({ ...cpuUsage(), ...memoryUsage(), timestamp: performance.now() });
    }, intervalSampleCPUAndMemory);
    try {
      const result = await task.run({
        onWarmupEnd: async () => {
          console.log("run start");
        },
        onRunEnd: async () => {
          console.log("waiting for task to clear");
        },
        onFnResult: (value) => collector.push(value),
      });
      console.log("run complete");
      return { ...result, intervalSampleData, inputInterval: intervalSampleCPUAndMemory };
    } finally {
      clearInterval(timer);
    }
  }
}

type RunOptions = {
  onFnResult?: (sample: ConcurrencyBenchSample) => void;
  onWarmupEnd?: () => Promise<void>;
  onRunEnd?: () => Promise<void>;
};

class ConcurrencyBenchTask {
  constructor(private readonly settings: BenchSetting, private readonly fn: () => Promise<void>) {
  }

  private readonly context: TaskRunnerContext = {
    currentConcurrency: 0,
    nextRequestIndex: 0,
    successCount: 0,
    errorCount: 0,
    targetConcurrency: 0,
    onSample: () => {},
  };

  private finished?: PromiseWithResolvers<void>;
  private stagePending?: PromiseWithResolvers<void>;
  private waitTime(time: number) {
    const resolver = Promise.withResolvers<void>();
    this.stagePending = resolver;
    const id = setTimeout(resolver.resolve, time);
    return resolver.promise.finally(() => clearTimeout(id));
  }
  async run(options: RunOptions = {}): Promise<ConcurrencyBenchResult> {
    if (this.finished) throw new Error("Task is already running");
    this.finished = Promise.withResolvers<void>();
    const { onFnResult, onWarmupEnd } = options;
    const context = this.context;

    let warmupResult: { iterations: number; duration: number };
    if (this.settings.warmupDuration <= 0 || this.settings.warmupConcurrency <= 0) {
      warmupResult = { iterations: 0, duration: 0 };
    } else {
      const { warmupDuration, warmupConcurrency } = this.settings;
      const startTime = performance.now();
      this.updateConcurrency(warmupConcurrency, context);
      await this.waitTime(warmupDuration);
      const endTime = performance.now();
      warmupResult = {
        iterations: context.nextRequestIndex,
        duration: endTime - startTime,
      };
    }
    if (onWarmupEnd) await onWarmupEnd();

    const { stages } = this.settings;
    const runStartIndex = context.nextRequestIndex;
    if (onFnResult) {
      context.onSample = (data) => {
        if (data[3] < runStartIndex) return;
        onFnResult(data);
      };
    }
    let i = 0;
    let stage = stages[i];
    const stageSamples: ConcurrencyBenchResult["stageSamples"] = [];
    while (stage) {
      const concurrency = stage.value;
      const startIndex = context.nextRequestIndex;
      this.updateConcurrency(concurrency, context);
      await this.waitTime(stage.duration);
      const endIndex = context.nextRequestIndex;
      stageSamples.push({ concurrency, startIndex, endIndex });
      i++;
      stage = stages[i];
    }
    context.targetConcurrency = 0;
    await this.finished.promise;
    return {
      stageSamples,
      warmup: warmupResult,
      name: this.settings.name,
    };
  }

  private onError(data: ConcurrencyBenchSample, context: TaskRunnerContext, error: Error) {
    const end = performance.now();
    data[1] = end;
    data[2] = false;
    context.errorCount++;
    context.onSample(data);
    if (context.errorCount <= this.settings.maxFailures) {
      if (context.currentConcurrency < context.targetConcurrency) {
        this.requestNext(end, context);
        return;
      }
    } else {
      const finalError = new Error("Max failures reached", { cause: error });
      this.abort(finalError);
    }

    this.onReduce(context);
  }
  private onSuccess(data: ConcurrencyBenchSample, context: TaskRunnerContext) {
    const end = performance.now();
    data[1] = end;
    data[2] = true;
    context.successCount++;
    context.onSample(data);
    if (context.currentConcurrency < context.targetConcurrency) {
      this.requestNext(end, context);
    } else {
      this.onReduce(context);
    }
  }
  private onReduce(context: TaskRunnerContext) {
    context.currentConcurrency--;
    if (context.currentConcurrency === 0) {
      this.finished?.resolve();
    }
  }
  private updateConcurrency(value: number, context: TaskRunnerContext) {
    const add = value - context.currentConcurrency;
    context.currentConcurrency = value;
    if (add > 0) {
      const start = performance.now();
      for (let i = 0; i < add; i++) {
        this.requestNext(start, context);
      }
    }
  }
  private requestNext(start: number, context: TaskRunnerContext) {
    const i = context.nextRequestIndex++;
    const data: ConcurrencyBenchSample = [start, 0, false, i];
    this.fn().then(() => this.onSuccess(data, context), (e) => this.onError(data, context, e)).catch((e) =>
      this.abort(e)
    );
  }

  private abort(error: Error) {
    this.context.targetConcurrency = 0;
    this.stagePending?.reject(error);
    this.finished?.reject(error);
  }
}

type TaskRunnerContext = {
  targetConcurrency: number;
  currentConcurrency: number;
  nextRequestIndex: number;

  successCount: number;
  errorCount: number;
  onSample: (sample: ConcurrencyBenchSample) => void;
};

function positive(value: number, name: string) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} must be finite and positive`);
}

function normalize(input: BenchInput): BenchSetting {
  const { duration = 3000, warmupDuration = 0, maxFailures = 0 } = input;
  positive(duration, "duration");
  if (!Number.isFinite(warmupDuration) || warmupDuration < 0) throw new RangeError("Invalid warmupDuration");
  if (!Number.isSafeInteger(maxFailures) || maxFailures < 0) throw new RangeError("Invalid maxFailures");
  const entries = typeof input.concurrency === "number" ? [input.concurrency] : input.concurrency;
  if (!entries.length) throw new RangeError("concurrency must not be empty");
  const stages = entries.map((entry) => {
    const stage = typeof entry === "number" ? { value: entry, duration } : { ...entry };
    if (!Number.isSafeInteger(stage.value) || stage.value < 1) throw new RangeError("Invalid concurrency");
    positive(stage.duration, "stage duration");
    return stage;
  });
  return { name: input.name ?? "", stages, warmupDuration, maxFailures, warmupConcurrency: stages[0].value };
}
type BenchSetting = {
  name: string;
  warmupDuration: number;
  warmupConcurrency: number;
  stages: ConcurrencyStage[];
  maxFailures: number;
};
