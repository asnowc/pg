import { expect, test } from "vitest";
import { setTimeout as delay } from "node:timers/promises";
import { ConcurrencyBench, type ConcurrencyBenchSample } from "../bench.ts";

test.each([
  { concurrency: [] },
  { concurrency: 0 },
  { concurrency: 1.5 },
  { concurrency: 1, duration: 0 },
  { concurrency: [{ value: 1, duration: Infinity }] },
  { concurrency: 1, warmupDuration: -1 },
  { concurrency: 1, maxFailures: -1 },
  { concurrency: 1, maxFailures: 0.5 },
])("rejects invalid configuration %j", (input) => {
  expect(() => new ConcurrencyBench(input)).toThrow();
});

test("runs ordered stages including a decrease and repeated values, then drains", async () => {
  let active = 0;
  let peak = 0;
  const samples: ConcurrencyBenchSample[] = [];
  const stages = [{ value: 4, duration: 25 }, { value: 1, duration: 20 }, { value: 1, duration: 20 }];
  const run = await new ConcurrencyBench({
    concurrency: stages,
    warmupDuration: 10,
  }).runWidthCpuAndMemory({
    fn: async () => {
      peak = Math.max(peak, ++active);
      await delay(8);
      active--;
    },
    intervalSampleCPUAndMemory: 1000,
    collector: samples,
  });
  expect(active).toBe(0);
  expect(peak).toBe(4);
  expect(run.warmup.iterations).toBeGreaterThan(0);
  expect(run.warmup.duration).toBeGreaterThanOrEqual(10);
  expect(run.stageSamples.map((stage) => stage.concurrency)).toEqual([4, 1, 1]);
  const startTime = run.intervalSampleData[0].timestamp;
  const endTime = run.intervalSampleData.at(-1)!.timestamp;
  expect(endTime - startTime).toBeGreaterThanOrEqual(65);
  for (const [index, stage] of run.stageSamples.entries()) {
    expect(stage.startIndex).toBe(index === 0 ? run.warmup.iterations : run.stageSamples[index - 1].endIndex);
    expect(stage.endIndex).toBeGreaterThanOrEqual(stage.startIndex);
  }
  expect(samples).toHaveLength(run.stageSamples.at(-1)!.endIndex - run.stageSamples[0].startIndex);
  expect(new Set(samples.map((sample) => sample[3])).size).toBe(samples.length);
  expect(samples.every((sample) => sample[0] >= startTime)).toBe(true);
  expect(samples.some((sample) => sample[1] >= endTime)).toBe(true);
  expect(run.intervalSampleData).toHaveLength(4);
  for (const sample of samples.filter((sample) => sample[3] >= run.stageSamples[1].startIndex)) {
    expect(samples.filter((other) => other[0] <= sample[0] && other[1] > sample[0]).length).toBeLessThanOrEqual(1);
  }
});

test("immediately resolved workloads yield to timers and keep all requested stages", async () => {
  let ticks = 0;
  const timer = setInterval(() => ticks++, 1);
  try {
    const samples: ConcurrencyBenchSample[] = [];
    const run = await new ConcurrencyBench({ concurrency: [100, 250, 500], duration: 15 }).runWidthCpuAndMemory({
      fn: () => Promise.resolve(),
      collector: samples,
      intervalSampleCPUAndMemory: 5,
    });
    expect(run.stageSamples.map((stage) => stage.concurrency)).toEqual([100, 250, 500]);
    expect(ticks).toBeGreaterThan(0);
    expect(run.intervalSampleData.length).toBeGreaterThanOrEqual(4);
    expect(samples.every((sample) => sample[2])).toBe(true);
  } finally {
    clearInterval(timer);
  }
});

test("only stops when failures strictly exceed the limit, including synchronous throws", async () => {
  let calls = 0;
  const task = new ConcurrencyBench({ concurrency: 1, maxFailures: 2, duration: 1000 }).createTask(() => {
    calls++;
    throw new Error(`failure-${calls}`);
  });
  const samples: ConcurrencyBenchSample[] = [];
  await expect(task.run({ onFnResult: (sample) => samples.push(sample) })).rejects.toThrow("failure-3");
  expect(calls).toBe(3);
  expect(samples).toHaveLength(3);
  expect(samples.every((sample) => !sample[2])).toBe(true);
  await task.waitPromiseClear();
  await expect(task.run()).rejects.toThrow("once");
  await expect(task.warmup()).rejects.toThrow();
});

test("an allowed failure continues, including across the warmup boundary", async () => {
  let calls = 0;
  const bench = new ConcurrencyBench({ concurrency: [1, 1], duration: 10, warmupDuration: 10, maxFailures: 1 });
  const task = bench.createTask(async () => {
    if (++calls === 1) throw new Error("allowed");
    await delay(1);
  });
  await task.warmup();
  const run = await task.run();
  expect(run.warmup.iterations).toBeGreaterThan(0);
  expect(run.stageSamples[0].startIndex).toBe(run.warmup.iterations);
  expect(run.stageSamples.at(-1)!.endIndex).toBeGreaterThan(run.stageSamples[0].startIndex);
  expect(run.stageSamples).toHaveLength(2);
});

test("warmup failure budget is not reset for measurement", async () => {
  let failing = true;
  const task = new ConcurrencyBench({ concurrency: 1, duration: 10, warmupDuration: 10, maxFailures: 1 })
    .createTask(async () => {
      await delay(1);
      if (failing) {
        failing = false;
        throw new Error("failure");
      }
    });
  await task.warmup();
  failing = true;
  await expect(task.run()).rejects.toThrow("failure");
});

test("failed warmup rejects without collecting measurement samples or allowing a retry", async () => {
  const error = new Error("warmup");
  const samples: ConcurrencyBenchSample[] = [];
  await expect(new ConcurrencyBench({ concurrency: 1, warmupDuration: 10 }).runWidthCpuAndMemory({
    fn: () => Promise.reject(error),
    collector: samples,
    intervalSampleCPUAndMemory: 5,
  })).rejects.toBe(error);
  expect(samples).toEqual([]);
  const task = new ConcurrencyBench({ concurrency: 1, warmupDuration: 10 }).createTask(() => Promise.reject(error));
  await expect(task.warmup()).rejects.toBe(error);
  await task.waitPromiseClear();
  await expect(task.run()).rejects.toThrow("once");
});

test("drain failures reject only after all in-flight requests and samples have completed", async () => {
  let active = 0;
  const samples: ConcurrencyBenchSample[] = [];
  const error = new Error("late");
  await expect(new ConcurrencyBench({ concurrency: 3, duration: 5, maxFailures: 2 }).runWidthCpuAndMemory({
    fn: async () => {
      active++;
      await delay(20);
      active--;
      throw error;
    },
    collector: samples,
    intervalSampleCPUAndMemory: 100,
  })).rejects.toBe(error);
  expect(active).toBe(0);
  expect(samples).toHaveLength(3);
  expect(samples.every((sample) => !sample[2])).toBe(true);
});

test("collector exceptions stop immediately, outside the query failure budget", async () => {
  const error = new Error("disk buffer full");
  let calls = 0;
  let collected = 0;
  await expect(new ConcurrencyBench({ concurrency: 2, duration: 500, maxFailures: 1000 }).runWidthCpuAndMemory({
    fn: () => {
      calls++;
      return Promise.resolve();
    },
    collector: {
      push() {
        collected++;
        throw error;
      },
    },
    intervalSampleCPUAndMemory: 10,
  })).rejects.toBe(error);
  expect(calls).toBe(2);
  expect(collected).toBe(1);
});

test("boundary callback failures and non-Error rejections propagate without hanging", async () => {
  const error = new Error("sample failure");
  const task = new ConcurrencyBench({ concurrency: 1 }).createTask(() => Promise.resolve());
  await expect(task.run({
    onBoundary: () => {
      throw error;
    },
  })).rejects.toBe(error);
  await task.waitPromiseClear();
  await expect(new ConcurrencyBench({ concurrency: 1 }).createTask(() => Promise.reject(undefined)).run())
    .rejects.toBeUndefined();
});

test("results expose only name, warmup, stage ranges and resource samples", async () => {
  const result = await new ConcurrencyBench({ concurrency: 1, duration: 1 }).runWidthCpuAndMemory({
    fn: () => Promise.resolve(),
    collector: [],
    intervalSampleCPUAndMemory: 10,
  });
  expect(Object.keys(result).sort()).toEqual([
    "name",
    "warmup",
    "stageSamples",
    "intervalSampleData",
    "inputInterval",
  ].sort());
});
