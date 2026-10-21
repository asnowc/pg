import { ConcurrencyBenchResult, ConcurrencyBenchResultWithCPUAndMemory } from "./types/bench_result.ts";
import { ConcurrencyBenchSample } from "./types/sample.ts";
import { cpuUsage, memoryUsage } from "node:process";

export type BenchInput = {
  name?: string;
  /** 最少迭代总时长 */
  duration?: number;

  /** 预热持续时间，默认 0 */
  warmupDuration?: number;
  /** 并发数 */
  concurrency: number | number[] | { value: number; duration: number }[];
};

export type ConcurrencyBenchConfig = BenchInput;

export interface BenchSampleCollector {
  push(sample: ConcurrencyBenchSample): void;
}
export class ConcurrencyBench {
  constructor(public config: ConcurrencyBenchConfig) {}

  createTask(fn: () => Promise<void>): ConcurrencyBenchTask {
    throw new Error("Method not implemented.");
  }
  async runWidthCpuAndMemory(
    options: {
      fn: () => Promise<void>;
      intervalSampleCPUAndMemory: number;
      collector: BenchSampleCollector;
    },
  ): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
    const { fn, intervalSampleCPUAndMemory, collector } = options ?? {};
    const taskRunner = this.createTask(fn);
    await taskRunner.warmup();

    let id: NodeJS.Timeout | undefined;
    const intervalData: ConcurrencyBenchResultWithCPUAndMemory["intervalSampleData"] = [];
    if (intervalSampleCPUAndMemory) {
      id = setInterval(() => {
        const sample = { ...cpuUsage(), ...memoryUsage(), timestamp: performance.now() };
        intervalData.push(sample);
      }, intervalSampleCPUAndMemory);
    }
    const result = await taskRunner.run({
      onFnResult: (sample) => collector.push(sample),
    }).finally(() => {
      if (id !== undefined) clearInterval(id);
    });
    await Promise.all([taskRunner.waitPromiseClear()]);
    return {
      ...result,
      intervalSampleData: intervalData,
      inputInterval: intervalSampleCPUAndMemory,
    };
  }
}

type TaskRunnerContext = {
  currentConcurrency: number;
  nextRequestIndex: number;
  successCount: number;
  errorCount: number;
};
export class ConcurrencyBenchTask {
  private context?: TaskRunnerContext;
  /** 等待所有 Promise 清空 */
  waitPromiseClear(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  warmup(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  run(options?: { onFnResult?: (sample: ConcurrencyBenchSample) => void }): Promise<ConcurrencyBenchResult> {
    throw new Error("Method not implemented.");
  }
}
