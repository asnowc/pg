import type { ConcurrencyDecision, ConcurrencyEstimate } from "./resource-report.ts";
import { createResourceSampler, sleep, withTimeout } from "./resource-runner.ts";

export interface AdaptiveOptions {
  steadyDuration: number;
  searchTimeout: number;
  minConcurrency: number;
  maxConcurrency: number;
  initialConcurrency: number;
  tuneInterval: number;
  minGainPercent: number;
  drainTimeout: number;
}

export function createConcurrencySearch(
  options: Pick<AdaptiveOptions, "minConcurrency" | "maxConcurrency" | "initialConcurrency" | "minGainPercent">,
) {
  const { minConcurrency, maxConcurrency, initialConcurrency, minGainPercent } = options;
  let concurrency = initialConcurrency;
  let step = initialConcurrency;
  let direction = 1;
  let refining = false;
  let probing = false;
  let baselineConcurrency = concurrency;
  let baselineQps = 0;
  let probeStep = 0;
  let gainThresholdPercent = minGainPercent;
  const unitProbeConcurrencies: number[] = [];

  return (qps: number, seconds: number): ConcurrencyDecision | undefined => {
    const previous = concurrency;
    let action: ConcurrencyDecision["action"];
    let converged = false;
    if (!probing) {
      baselineConcurrency = concurrency;
      baselineQps = qps;
      const neighbor = () => Math.max(minConcurrency, Math.min(maxConcurrency, concurrency + direction * step));
      let next = neighbor();
      if (next === concurrency) {
        refining = true;
        step = Math.max(1, Math.floor(step / 2));
        direction *= -1;
        next = neighbor();
      }
      if (next === concurrency) return;
      probeStep = Math.abs(next - concurrency);
      gainThresholdPercent = minGainPercent * (refining ? Math.min(1, probeStep / baselineConcurrency) : 1);
      concurrency = next;
      probing = true;
      action = "probe";
    } else {
      if (qps > baselineQps * (1 + gainThresholdPercent / 100)) {
        if (!refining) step = concurrency;
        action = "accept";
      } else {
        concurrency = baselineConcurrency;
        refining = true;
        step = Math.max(1, Math.floor(probeStep / 2));
        direction *= -1;
        action = "revert";
      }
      if (probeStep === 1 && baselineQps > 0) {
        unitProbeConcurrencies.push(previous);
        if (unitProbeConcurrencies.length > 5) unitProbeConcurrencies.shift();
        if (unitProbeConcurrencies.length === 5) {
          const increasing = unitProbeConcurrencies.every((value, index, values) =>
            index === 0 || value > values[index - 1]
          );
          const decreasing = unitProbeConcurrencies.every((value, index, values) =>
            index === 0 || value < values[index - 1]
          );
          converged = !increasing && !decreasing;
        }
      } else {
        unitProbeConcurrencies.length = 0;
      }
      // Refresh the baseline after every probe; refinement never expands its step again.
      probing = false;
    }
    return {
      seconds,
      previous,
      next: concurrency,
      qps,
      baselineQps,
      action,
      step: probeStep,
      nextStep: step,
      phase: refining ? "refine" : "coarse",
      gainThresholdPercent,
      converged,
    };
  };
}

export async function measureAdaptive(query: () => Promise<void>, options: AdaptiveOptions) {
  const {
    steadyDuration,
    searchTimeout,
    initialConcurrency,
    minConcurrency,
    maxConcurrency,
    tuneInterval,
    drainTimeout,
  } = options;
  let concurrency = initialConcurrency;
  let started = 0;
  let succeeded = 0;
  let failed = 0;
  let inFlight = 0;
  let stopped = false;
  let firstError: string | undefined;
  let onDrained: (() => void) | undefined;
  const decisions: ConcurrencyDecision[] = [];
  const estimates: ConcurrencyEstimate[] = [];
  let estimating = minConcurrency !== maxConcurrency;
  let calibrationCompleted = 0;
  let calibrationLatencyMs = 0;
  const sampler = createResourceSampler(() => ({
    succeeded,
    failed,
    dropped: 0,
    inFlight,
    concurrency,
  }));
  const { start } = sampler;
  const searchDeadline = start + searchTimeout * 1000;
  let searchCompletedAt: number | null = estimating ? null : start;
  let convergedConcurrency: number | null = estimating ? null : concurrency;
  let steadyStartCompleted = 0;
  let end = searchCompletedAt === null ? searchDeadline : searchCompletedAt + steadyDuration * 1000;
  let nextSample = start + 1000;
  let nextTune = start + tuneInterval * 1000;
  let windowStart = start;
  let windowSucceeded = 0;
  let search = createConcurrencySearch(options);
  let calibrationStart = start;

  function fill() {
    while (!stopped && firstError === undefined && inFlight < concurrency && performance.now() < end) {
      started++;
      inFlight++;
      void request();
    }
  }

  async function request() {
    const queryStart = estimating ? performance.now() : undefined;
    try {
      await query();
      succeeded++;
      if (estimating && queryStart !== undefined) {
        calibrationCompleted++;
        calibrationLatencyMs += performance.now() - queryStart;
      }
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

  function estimate(now: number, cpuUs: number) {
    const elapsedSeconds = (now - calibrationStart) / 1000;
    const averageLatencyMs = calibrationCompleted > 0 ? calibrationLatencyMs / calibrationCompleted : null;
    const cpuUsPerQuery = calibrationCompleted > 0 ? cpuUs / calibrationCompleted : null;
    let estimatedConcurrency: number | null = null;
    let reason: string | undefined;
    if (averageLatencyMs !== null && averageLatencyMs > 0 && cpuUsPerQuery !== null && cpuUsPerQuery > 0) {
      // Little's law at an estimated 90% of one CPU core; probes must validate this heuristic.
      estimatedConcurrency = Math.max(
        minConcurrency,
        Math.min(maxConcurrency, Math.ceil((900000 / cpuUsPerQuery) * averageLatencyMs / 1000)),
      );
    } else {
      reason = "Insufficient completed-query latency or positive CPU time; using a bounded capacity probe";
      console.error(`[estimate] ${reason}`);
    }
    const next = Math.min(
      maxConcurrency,
      Math.max(
        minConcurrency,
        concurrency,
        estimatedConcurrency ?? concurrency,
        estimates.length === 0 ? concurrency * 8 : concurrency,
      ),
    );
    const record: ConcurrencyEstimate = {
      seconds: (now - start) / 1000,
      concurrency,
      completed: calibrationCompleted,
      elapsedSeconds,
      cpuUs,
      averageLatencyMs,
      cpuUsPerQuery,
      estimatedConcurrency,
      nextConcurrency: next,
      reason,
    };
    estimates.push(record);
    concurrency = next;
    console.log(
      `[estimate ${record.seconds.toFixed(1)}s] CPU/latency estimate=${estimatedConcurrency}, next concurrency=${next}`,
    );
    calibrationStart = now;
    calibrationCompleted = 0;
    calibrationLatencyMs = 0;
    if (estimates.length === 2) {
      estimating = false;
      search = createConcurrencySearch({ ...options, initialConcurrency: concurrency });
      windowStart = now;
      windowSucceeded = succeeded;
      nextTune = now + tuneInterval * 1000;
    }
    fill();
  }

  function tune(now: number) {
    const qps = (succeeded - windowSucceeded) / ((now - windowStart) / 1000);
    windowSucceeded = succeeded;
    windowStart = now;
    const decision = search(qps, (now - start) / 1000);
    if (!decision) return;
    concurrency = decision.next;
    decisions.push(decision);
    if (decision.converged && searchCompletedAt === null) {
      searchCompletedAt = now;
      convergedConcurrency = concurrency;
      steadyStartCompleted = succeeded;
      end = now + steadyDuration * 1000;
      console.log(
        `[converged ${
          decision.seconds.toFixed(1)
        }s] concurrency=${concurrency}; continue tuning for ${steadyDuration}s`,
      );
    }
    console.log(
      `[adaptive ${
        decision.seconds.toFixed(1)
      }s] ${decision.action}: concurrency ${decision.previous}->${concurrency}, ${
        qps.toFixed(1)
      } queries/s, ${decision.phase} step=${decision.step} nextStep=${decision.nextStep}`,
    );
  }

  fill();
  while (performance.now() < end && firstError === undefined) {
    const now = performance.now();
    if (now >= nextSample && now < end) {
      const sample = sampler.sample(now);
      nextSample = now + 1000;
      if (estimating) {
        const cpuUs = sample.cpuPercent * sample.intervalSeconds * 10000;
        estimate(now, cpuUs);
      } else if (now >= nextTune) {
        tune(now);
        nextTune = now + tuneInterval * 1000;
        fill();
      }
    }
    await sleep(Math.min(10, Math.max(0, end - performance.now())));
  }
  stopped = true;
  const completedInWindow = succeeded;
  const endTime = performance.now();
  const resources = sampler.finish(endTime);
  const steadyCompleted = searchCompletedAt === null ? 0 : completedInWindow - steadyStartCompleted;
  const steadyElapsedSeconds = searchCompletedAt === null ? 0 : (endTime - searchCompletedAt) / 1000;
  const searchError = searchCompletedAt === null && firstError === undefined
    ? `Concurrency search did not converge within ${searchTimeout}s`
    : undefined;
  if (searchError) console.error(searchError);
  const inFlightAtEnd = inFlight;
  let drained = true;
  let drainError: string | undefined;
  if (inFlight > 0) {
    try {
      await withTimeout(
        new Promise<void>((resolve) => onDrained = resolve),
        drainTimeout,
        "Outstanding queries",
      );
    } catch (error) {
      drained = false;
      drainError = error instanceof Error ? error.message : String(error);
      console.error(error);
    } finally {
      onDrained = undefined;
    }
  }
  let peakQps = 0;
  let peakConcurrency: number | null = null;
  for (const sample of resources.samples) {
    if (sample.intervalSeconds >= 1 && (peakConcurrency === null || sample.successQps > peakQps)) {
      peakQps = sample.successQps;
      peakConcurrency = sample.concurrency;
    }
  }
  return {
    ...resources,
    scheduled: started,
    started,
    succeeded,
    failed,
    dropped: 0,
    inFlightAtEnd,
    drained,
    firstError,
    drainError,
    completedInWindow,
    averageQps: completedInWindow / resources.elapsedSeconds,
    peakQps,
    peakConcurrency,
    finalConcurrency: concurrency,
    decisions,
    estimates,
    searchConverged: searchCompletedAt !== null,
    searchCompletedAtSeconds: searchCompletedAt === null ? null : (searchCompletedAt - start) / 1000,
    convergedConcurrency,
    steadyCompleted,
    steadyElapsedSeconds,
    steadyAverageQps: searchCompletedAt === null ? null : steadyCompleted / steadyElapsedSeconds,
    searchError,
  };
}
