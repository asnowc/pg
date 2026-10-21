import { expect, test } from "vitest";
import {
  analyzeSampleGroup,
  type ConcurrencyBenchResultWithCPUAndMemory,
  type ConcurrencyBenchSample,
} from "../../bench.ts";

function runData(): ConcurrencyBenchResultWithCPUAndMemory {
  return {
    name: "client",
    warmup: { iterations: 0, duration: 0 },
    inputInterval: 1000,
    stageSamples: [
      { concurrency: 2, startIndex: 0, endIndex: 2 },
      { concurrency: 2, startIndex: 2, endIndex: 5 },
    ],
    intervalSampleData: [0, 1000, 3000].map((timestamp, index) => ({
      timestamp,
      user: index * 1000000,
      system: 0,
      rss: index * 2 * 1024 ** 2,
      heapUsed: index * 1024 ** 2,
      external: index * 512 * 1024,
      heapTotal: 0,
      arrayBuffers: 0,
    })),
  };
}
function analyze(samples: ConcurrencyBenchSample[], groupBy?: (sample: ConcurrencyBenchSample) => string | undefined) {
  const run = runData();
  return analyzeSampleGroup({
    sampleGroup: { name: "client", startTime: 0, endTime: 3000, samples, sampleCount: samples.length },
    intervalSamples: run,
    groupBy,
  });
}

test("uses request id ranges even when completion order differs or requests drain after measurement", () => {
  const samples: ConcurrencyBenchSample[] = [
    [98, 100, true, 0],
    [896, 900, true, 1],
    [1000, 1005, true, 2],
    [1100, 1200, false, 3],
    [2995, 3000, true, 4],
  ];
  const copy = structuredClone(samples);
  const result = analyze(samples);
  const stats = result.resultGroup.get("client")!;
  expect(stats).toMatchObject({
    min: 2,
    max: 5,
    mean: 4,
    p50: 4,
    p75: 5,
    p90: 5,
    p95: 5,
    p99: 5,
    p995: 5,
    p999: 5,
    sampleCount: 5,
    successCount: 4,
    errorCount: 1,
  });
  expect(stats.rme).toBeCloseTo(3.182446 * Math.sqrt(2 / 4) / 4 * 100, 5);
  expect(result.intervalSample.cpu).toEqual([100, 50]);
  expect(result.intervalSample.rss).toEqual([2, 4]);
  expect(result.intervalSample.jsHeap).toEqual([1, 2]);
  expect(result.intervalSample.memoryExtended).toEqual([0.5, 1]);
  expect(result.intervalSample.qps).toEqual([2, 0.5]);
  expect(result.intervalSample.seconds).toEqual([1, 3]);
  expect(result.intervalSample.stages.map((stage) => stage.statistics.sampleCount)).toEqual([2, 3]);
  expect(result.intervalSample.stages.map((stage) => stage.averages.qps)).toEqual([2, 1]);
  expect(samples).toEqual(copy);
});

test("weights resource averages by actual interval length", () => {
  const run = runData();
  run.stageSamples = [{ concurrency: 2, startIndex: 0, endIndex: 0 }];
  const result = analyzeSampleGroup({
    sampleGroup: { name: "client", startTime: 0, endTime: 3000, sampleCount: 0, samples: [] },
    intervalSamples: run,
  });
  expect(result.intervalSample.stages[0].averages.cpu).toBeCloseTo(200 / 3);
  expect(result.intervalSample.stages[0].averages.rss).toBeCloseTo(10 / 3);
});

test("groupBy drops samples from query metrics and groups without mutating input", () => {
  const result = analyze([[0, 10, true, 0], [0, 20, true, 1]], (sample) => sample[3] ? undefined : "kept");
  expect([...result.resultGroup.keys()]).toEqual(["kept"]);
  expect(result.resultGroup.get("kept")?.sampleCount).toBe(1);
  expect(result.intervalSample.qps).toEqual([1, 0]);
});

test("empty, all-error, one-success and zero-latency samples have explicit unavailable statistics", () => {
  expect(analyze([]).resultGroup.get("client")).toMatchObject({ mean: null, rme: null, sampleCount: 0 });
  expect(analyze([[0, 10, false, 0]]).resultGroup.get("client")).toMatchObject({ mean: null, errorCount: 1 });
  expect(analyze([[0, 10, true, 0]]).resultGroup.get("client")).toMatchObject({ mean: 10, rme: null });
  expect(analyze([[0, 0, true, 0], [1, 1, true, 1]]).resultGroup.get("client")).toMatchObject({ mean: 0, rme: null });
});

test("groups out-of-order completions by request id and retains late completions", () => {
  const result = analyze([[1000, 1100, true, 2], [0, 4000, true, 0], [500, 700, false, 1]]);
  expect(result.intervalSample.stages.map((stage) => stage.statistics.sampleCount)).toEqual([2, 1]);
  expect(result.intervalSample.stages[0].statistics.mean).toBe(4000);
  expect(result.resultGroup.get("client")?.successCount).toBe(2);
});
