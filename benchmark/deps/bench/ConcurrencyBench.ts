import type { ConcurrencyBenchResultWithCPUAndMemory, ConcurrencyBenchSample } from "./types/bench_result.ts";
import { cpuUsage, memoryUsage } from "node:process";
import { ConcurrencyRunner } from "./utils/ConcurrencyRunner.ts";
import { BenchSetting, runBench, StageEndInfo, WarmupEndInfo } from "./utils/runBench.ts";
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
   * 预热只使用第一档并发，结束时不排空；预热操作的结果不会传给收集器。
   *
   * 正式操作按成功或失败分别向两个收集器投递 `[startTime, endTime]`，
   * 时间单位为毫秒。操作失败不终止测量，也不会使返回的 Promise 拒绝。
   * CPU/内存快照按 intervalSampleCPUAndMemory 指定的毫秒间隔采集，包含预热和最终排空；
   * 预热结束、每档开始（并发调整之后）和停止补发时会立即补采一次；定时器不随之重新对齐。
   *
   * 当前收集器异常仅记录日志并将目标并发设为 0，不会作为返回 Promise 的拒绝原因；
   * 后续档位仍可能恢复派发，排空期间的收集器异常可能导致等待无法完成。
   * 持续立即兑现或拒绝的 fn 可能使阶段计时器饥饿。
   * 调用方负责连接释放以及文件收集器的最终刷新和关闭。
   * @since 0.2.5
   */
  async runWidthCpuAndMemory(options: {
    fn: (index: number) => Promise<unknown>;
    intervalSampleCPUAndMemory: number;
    collectorSuccess: BenchSampleCollector;
    collectorFailed: BenchSampleCollector;
    /** 进度回调，省略时不输出任何日志。 */
    onProgress?: (event: ProgressEvent) => void;
  }): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
    const { fn, intervalSampleCPUAndMemory, collectorSuccess, collectorFailed, onProgress } = options;
    await fn(-1); // 测试调用
    const runner = new ConcurrencyRunner(fn);

    const intervalSampleData: ConcurrencyBenchResultWithCPUAndMemory["snapshot"] = [];

    const snapshot = () => {
      intervalSampleData.push({
        ...cpuUsage(),
        ...memoryUsage(),
        timestamp: performance.now(),
        currentConcurrency: runner.currentConcurrency,
        nextOperationIndex: runner.nextOperationIndex,
        successCount: runner.successCount,
        errorCount: runner.errorCount,
      });
    };
    const timer = setInterval(snapshot, intervalSampleCPUAndMemory);
    let warmupEndOperationIndex: number = 0;
    let errorReported = false;
    try {
      const result = await runBench(runner, this.settings, {
        onWarmupEnd: (info) => {
          warmupEndOperationIndex = runner.nextOperationIndex;
          onProgress?.({ type: "warmup-end", data: info });
        },
        onStageStart: (index) => {
          snapshot();
        },
        onStageEnd: (info) => {
          onProgress?.({ type: "stage-end", data: info });
        },
        onRunEnd: snapshot,
        onSampleFailed: (value, index, error) => {
          if (index < warmupEndOperationIndex) return;
          if (!errorReported) {
            errorReported = true;
            onProgress?.({ type: "first-error", data: { error } });
          }
          collectorFailed.push(value);
        },
        onSampleSuccess: (value, index) => {
          if (index < warmupEndOperationIndex) return;
          collectorSuccess.push(value);
        },
      });
      snapshot();
      return { ...result, snapshot: intervalSampleData };
    } finally {
      clearInterval(timer);
    }
  }
}

export interface IntervalBenchRunner {
  (fn: (index: number) => Promise<void>): Promise<void>;
}

/**
 * runWidthCpuAndMemory 的进度事件。stage-end 的 success/failed 为该档期间完成的操作数；
 * first-error 只在第一个正式操作失败时触发一次。排空信息可在返回结果中由 endTime/clearTime 得到。
 */
export type ProgressEvent =
  | { type: "warmup-end"; data: WarmupEndInfo }
  | { type: "stage-end"; data: StageEndInfo }
  | { type: "first-error"; data: { error: unknown } };

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
