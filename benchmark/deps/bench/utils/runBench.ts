import type { ConcurrencyBenchResult, ConcurrencyBenchSample, OperationRunnerContext } from "../types/bench_result.ts";
import { ConcurrencyRunner } from "./ConcurrencyRunner.ts";

export type ConcurrencyStage = { value: number; duration: number };
export type BenchSetting = {
  name: string;
  warmupDuration: number;
  warmupConcurrency: number;
  stages: ConcurrencyStage[];
};

export async function runBench(runner: ConcurrencyRunner, settings: BenchSetting, options: RunOptions) {
  const { onWarmupEnd, onSampleFailed, onSampleSuccess } = options;
  let runStartSnapshot: OperationRunnerContext;
  let warmupResult: { concurrency: number; iterations: number; duration: number };
  if (settings.warmupDuration <= 0 || settings.warmupConcurrency <= 0) {
    warmupResult = { concurrency: 0, iterations: 0, duration: 0 };
  } else {
    const { warmupDuration, warmupConcurrency } = settings;
    const startTime = performance.now();
    runner.updateConcurrency(warmupConcurrency);
    await new Promise<void>((resolve) => setTimeout(resolve, warmupDuration));
    const endTime = performance.now();
    warmupResult = {
      concurrency: warmupConcurrency,
      iterations: runner.nextOperationIndex,
      duration: endTime - startTime,
    };
  }
  if (onWarmupEnd) await onWarmupEnd(warmupResult);

  const { stages } = settings;
  const runStartIndex = runner.nextOperationIndex;
  const startTime = performance.now();
  // 预热发起的操作开始时间早于 startTime，不传给收集器
  if (onSampleSuccess) {
    runner.onSampleSuccess = (data, operationIndex) => {
      if (operationIndex < runStartIndex) return;
      onSampleSuccess(data, operationIndex);
    };
  }
  if (onSampleFailed) {
    runner.onSampleFailed = (data, operationIndex, error) => {
      if (operationIndex < runStartIndex) return;
      onSampleFailed(data, operationIndex, error);
    };
  }
  let i = 0;
  let stage = stages[i];
  const stageSamples: ConcurrencyBenchResult["stageSamples"] = [];
  while (stage) {
    runStartSnapshot = runner.getStateSnapshot();
    const concurrency = stage.value;
    stageSamples.push({ concurrency, startTime: i === 0 ? startTime : performance.now() });
    runner.updateConcurrency(concurrency);
    options.onStageStart?.(i);
    await new Promise<void>((resolve) => setTimeout(resolve, stage.duration));
    options.onStageEnd?.({
      index: i,
      total: stages.length,
      concurrency,
      duration: performance.now() - stageSamples[i].startTime,
      success: runner.successCount - runStartSnapshot.successCount,
      failed: runner.errorCount - runStartSnapshot.errorCount,
    });
    i++;
    stage = stages[i];
  }
  runner.targetConcurrency = 0;
  const endTime = performance.now();
  await options.onRunEnd?.();
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
  onSampleFailed?: (sample: ConcurrencyBenchSample, index: number, error: unknown) => void;
  onSampleSuccess?: (sample: ConcurrencyBenchSample, index: number) => void;
  onWarmupEnd?: (info: WarmupEndInfo) => Promise<void> | void;
  /** 档位开始并已按新目标补发后同步调用，此时在途数已反映新档位。 */
  onStageStart?: (index: number) => void;
  onStageEnd?: (info: StageEndInfo) => void;
  /** 最后一档结束、开始排空前调用。 */
  onRunEnd?: () => Promise<void> | void;
};
export type WarmupEndInfo = {
  concurrency: number;
  iterations: number;
  duration: number;
};
export type StageEndInfo = {
  index: number;
  total: number;
  concurrency: number;
  duration: number;
  success: number;
  failed: number;
};
