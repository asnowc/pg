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
    await task.warmup();
    const intervalSampleData: ConcurrencyBenchResultWithCPUAndMemory["intervalSampleData"] = [];

    const timer = setInterval(() => {
      intervalSampleData.push({ ...cpuUsage(), ...memoryUsage(), timestamp: performance.now() });
    }, intervalSampleCPUAndMemory);
    try {
      const result = await task.run({
        onFnResult: (value) => collector.push(value),
      });
      await task.waitPromiseClear();
      return { ...result, intervalSampleData, inputInterval: intervalSampleCPUAndMemory };
    } finally {
      clearInterval(timer);
    }
  }
}

type RunOptions = {
  onFnResult?: (sample: ConcurrencyBenchSample) => void;
};

class ConcurrencyBenchTask {
  constructor(private readonly settings: BenchSetting, private readonly fn: () => Promise<void>) {
  }
  private errored?: Error;
  private clearListeners = new Set<{ resolve: () => void; reject: (error: any) => void }>();
  /** 等待当前阶段停止补发后的所有查询与样本回调完成。 */
  waitPromiseClear(): Promise<void> {
    if (this.errored) {
      return Promise.reject(this.errored);
    }
    return new Promise<void>((resolve, reject) => {
      this.clearListeners.add({ resolve, reject });
    });
  }
  private readonly context: TaskRunnerContext = {
    currentConcurrency: 0,
    nextRequestIndex: 0,
    successCount: 0,
    errorCount: 0,
    targetConcurrency: 0,
    onSample: () => {},
  };

  private warmupRunning = false;
  private warmupResult?: ConcurrencyBenchResult["warmup"];
  async warmup(): Promise<void> {
    if (this.warmupRunning) throw new Error("Warmup has already been run");
    const { warmupDuration, warmupConcurrency } = this.settings;
    if (warmupDuration <= 0 || warmupConcurrency <= 0) return;

    this.warmupRunning = true;
    const startTime = performance.now();
    this.updateConcurrency(warmupConcurrency);
    await new Promise((resolve) => setTimeout(resolve, warmupDuration));
    const context = this.context;
    context.currentConcurrency = 0;
    const endTime = performance.now();

    this.warmupResult = {
      iterations: context.nextRequestIndex,
      duration: endTime - startTime,
    };

    this.warmupRunning = false;
  }

  private running = true;
  async run(options: RunOptions = {}): Promise<ConcurrencyBenchResult> {
    if (this.running) throw new Error("Task is already running");
    this.running = true;
    const { onFnResult } = options;
    const stages = this.settings.stages;
    const context = this.context;
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
      this.updateConcurrency(concurrency);
      await new Promise((resolve) => setTimeout(resolve, stage.duration));
      const endIndex = context.nextRequestIndex;
      stageSamples.push({ concurrency, startIndex, endIndex });
      i++;
      stage = stages[i];
    }
    context.currentConcurrency = 0;
    this.running = false;
    return {
      stageSamples,
      warmup: this.warmupResult ?? { iterations: 0, duration: 0 },
      name: this.settings.name,
    };
  }

  private onError(data: ConcurrencyBenchSample, context: TaskRunnerContext) {
    const end = performance.now();
    data[1] = end;
    data[2] = false;
    context.errorCount++;
    if (context.errorCount <= this.settings.maxFailures) {
      if (context.targetConcurrency < context.currentConcurrency) {
        this.requestNext(end, context);
        return;
      }
      this.errored = new Error("Max failures reached");
    }

    this.onSub(context);
  }
  private onSuccess(data: ConcurrencyBenchSample, context: TaskRunnerContext) {
    const end = performance.now();
    data[1] = end;
    data[2] = true;
    context.successCount++;
    if (context.targetConcurrency < context.currentConcurrency) {
      this.requestNext(end, context);
    } else {
      this.onSub(context);
    }
  }
  private onSub(context: TaskRunnerContext) {
    context.currentConcurrency--;
    if (context.currentConcurrency === 0) {
      for (const fn of this.clearListeners) {
        fn.resolve();
      }
      this.clearListeners.clear();
    }
  }
  private updateConcurrency(value: number) {
    const add = value - this.context.currentConcurrency;
    this.context.currentConcurrency = value;
    if (add > 0) {
      const start = performance.now();
      for (let i = 0; i < add; i++) {
        this.requestNext(start, this.context);
      }
    }
  }
  private requestNext(start: number, context: TaskRunnerContext) {
    const i = this.context.nextRequestIndex++;
    const data: ConcurrencyBenchSample = [start, 0, false, i];
    this.fn().then(() => this.onSuccess(data, context), () => this.onError(data, context));
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
