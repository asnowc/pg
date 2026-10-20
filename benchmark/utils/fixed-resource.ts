import { createResourceSampler, sleep } from "./resource-runner.ts";
import type { ConcurrencyStage } from "./resource-report.ts";

export interface FixedOptions {
  concurrency: number[];
  warmup: number;
  duration: number;
}

export async function measureFixed(query: () => Promise<void>, options: FixedOptions) {
  const { concurrency, warmup, duration } = options;
  let started = 0;
  let succeeded = 0;
  let failed = 0;
  let inFlight = 0;
  let stopped = false;
  let firstError: string | undefined;
  let onDrained: (() => void) | undefined;
  let stageIndex = 0;
  let activeConcurrency = concurrency[0];
  const stages: ConcurrencyStage[] = [];
  const sampler = createResourceSampler(() => ({
    succeeded,
    failed,
    dropped: 0,
    inFlight,
    concurrency: activeConcurrency,
  }));
  const warmupEnd = sampler.start + warmup * 1000;
  let measurementStart: number | null = warmup === 0 ? sampler.start : null;
  let stageStart = measurementStart ?? warmupEnd;
  let stageStartCompleted = 0;
  let end = warmupEnd + duration * 1000;
  let nextSample = sampler.start + 1000;
  let completedInWindow = 0;
  let measurementElapsedSeconds = 0;
  let inFlightAtEnd = 0;
  let finishedResources: ReturnType<typeof sampler.finish> | undefined;

  function recordStage(now: number) {
    const elapsedSeconds = (now - stageStart) / 1000;
    const completed = succeeded - stageStartCompleted;
    stages.push({
      concurrency: activeConcurrency,
      startSeconds: (stageStart - sampler.start) / 1000,
      endSeconds: (now - sampler.start) / 1000,
      elapsedSeconds,
      completedInWindow: completed,
      averageQps: completed / elapsedSeconds,
    });
    completedInWindow += completed;
    measurementElapsedSeconds += elapsedSeconds;
  }

  function finishMeasurement(now: number) {
    stopped = true;
    inFlightAtEnd = inFlight;
    if (measurementStart !== null) recordStage(now);
    finishedResources = sampler.finish(now);
    return finishedResources;
  }

  function advance(now: number) {
    if (stopped || firstError !== undefined) return;
    if (measurementStart === null && now >= warmupEnd) {
      // Boundary samples keep warmup and adjacent stages out of each other's averages.
      sampler.sample(now);
      measurementStart = now;
      stageStart = now;
      stageStartCompleted = succeeded;
      end = now + duration * 1000;
      nextSample = now + 1000;
      console.log(`[warmup ${((now - sampler.start) / 1000).toFixed(2)}s] complete; concurrency=${activeConcurrency}`);
    }
    if (measurementStart === null || now < end) return;
    if (stageIndex === concurrency.length - 1) {
      finishMeasurement(now);
      return;
    }
    sampler.sample(now);
    recordStage(now);
    stageIndex++;
    activeConcurrency = concurrency[stageIndex];
    stageStart = now;
    stageStartCompleted = succeeded;
    end = now + duration * 1000;
    nextSample = now + 1000;
    console.log(
      `[stage ${stageIndex + 1}/${concurrency.length} ${((now - sampler.start) / 1000).toFixed(2)}s] ` +
        `concurrency=${activeConcurrency}; measuring for ${duration}s`,
    );
  }

  function fill() {
    while (!stopped && firstError === undefined && inFlight < activeConcurrency && performance.now() < end) {
      started++;
      inFlight++;
      void request();
    }
  }

  async function request() {
    try {
      await query();
      const now = performance.now();
      advance(now);
      succeeded++;
    } catch (error) {
      failed++;
      if (firstError === undefined) {
        firstError = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        console.error(`Query failed: ${firstError}`);
      }
    } finally {
      inFlight--;
      fill();
      if (inFlight === 0) onDrained?.();
    }
  }

  fill();
  while (!stopped && firstError === undefined) {
    const now = performance.now();
    advance(now);
    if (stopped) break;
    if (now >= nextSample) {
      sampler.sample(now);
      nextSample = now + 1000;
    }
    fill();
    await sleep(Math.min(10, Math.max(0, end - performance.now())));
  }
  const resources = finishedResources ?? finishMeasurement(performance.now());
  if (inFlight > 0) {
    await new Promise<void>((resolve) => onDrained = resolve);
    onDrained = undefined;
  }
  let peakQps = 0;
  for (const sample of resources.samples) {
    if (sample.intervalSeconds >= 1) peakQps = Math.max(peakQps, sample.successQps);
  }
  return {
    ...resources,
    scheduled: started,
    started,
    succeeded,
    failed,
    dropped: 0,
    inFlightAtEnd,
    drained: true,
    firstError,
    warmupCompletedAtSeconds: measurementStart === null ? null : (measurementStart - sampler.start) / 1000,
    measurementElapsedSeconds,
    stages,
    completedInWindow,
    averageQps: measurementElapsedSeconds > 0 ? completedInWindow / measurementElapsedSeconds : null,
    peakQps,
  };
}
