import { type InstantMetric, snapshotMetric } from "./sample_group.ts";
import type { ConcurrencyBenchResultWithCPUAndMemory } from "../types/bench_result.ts";

export type CpuMetric = "user" | "system" | "total";
export type ResourceWindow = {
  cpuPerOperation: Record<CpuMetric, number | null>;
  memory: Record<Exclude<InstantMetric, "inFlight">, number | null>;
  completed: number;
};
export type CpuInterval = {
  startSeconds: number;
  endSeconds: number;
  user: number;
  system: number;
  total: number;
  utilization: number;
};

/** CPU deltas are in ms; snapshots contain cumulative microseconds. */
export function cpuIntervals(run: ConcurrencyBenchResultWithCPUAndMemory): CpuInterval[] {
  const { snapshot, startTime, endTime } = run;
  const intervals: CpuInterval[] = [];
  for (let i = 1; i < snapshot.timestamp.length; i++) {
    const previous = snapshot.timestamp[i - 1];
    const current = snapshot.timestamp[i];
    const start = Math.max(startTime, previous);
    const end = Math.min(endTime, current);
    if (end <= start || current <= previous) continue;
    const fraction = (end - start) / (current - previous);
    const user = (snapshot.user[i] - snapshot.user[i - 1]) / 1000 * fraction;
    const system = (snapshot.system[i] - snapshot.system[i - 1]) / 1000 * fraction;
    intervals.push({
      startSeconds: (start - startTime) / 1000,
      endSeconds: (end - startTime) / 1000,
      user,
      system,
      total: user + system,
      utilization: (user + system) / (end - start) * 100,
    });
  }
  return intervals;
}

/** Prorate counter deltas at window boundaries; memory uses the interval's right snapshot. */
export function resourceWindow(
  run: ConcurrencyBenchResultWithCPUAndMemory,
  start = run.startTime,
  end = run.endTime,
): ResourceWindow {
  const { snapshot } = run;
  let elapsed = 0;
  let completed = 0;
  let user = 0;
  let system = 0;
  const memory = { rss: 0, jsHeap: 0, memoryExtended: 0, arrayBuffers: 0 };
  const metrics = Object.keys(memory) as (keyof typeof memory)[];
  for (let i = 1; i < snapshot.timestamp.length; i++) {
    const previous = snapshot.timestamp[i - 1];
    const current = snapshot.timestamp[i];
    const overlap = Math.min(end, current) - Math.max(start, previous);
    if (overlap <= 0 || current <= previous) continue;
    const fraction = overlap / (current - previous);
    elapsed += overlap;
    user += (snapshot.user[i] - snapshot.user[i - 1]) * fraction;
    system += (snapshot.system[i] - snapshot.system[i - 1]) * fraction;
    completed += (snapshot.successCount[i] + snapshot.errorCount[i] -
      snapshot.successCount[i - 1] - snapshot.errorCount[i - 1]) * fraction;
    for (const metric of metrics) memory[metric] += snapshotMetric(snapshot, i, metric) * overlap;
  }
  return {
    completed,
    cpuPerOperation: {
      user: elapsed > 0 && completed > 0 ? user / completed : null,
      system: elapsed > 0 && completed > 0 ? system / completed : null,
      total: elapsed > 0 && completed > 0 ? (user + system) / completed : null,
    },
    memory: {
      rss: elapsed > 0 ? memory.rss / elapsed : null,
      jsHeap: elapsed > 0 ? memory.jsHeap / elapsed : null,
      memoryExtended: elapsed > 0 ? memory.memoryExtended / elapsed : null,
      arrayBuffers: elapsed > 0 ? memory.arrayBuffers / elapsed : null,
    },
  };
}
