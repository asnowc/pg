import { cpuUsage, memoryUsage } from "node:process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PoolQueryTest } from "./common.ts";
import { type AdaptiveResourceResult, renderResourceChart, type ResourceSample } from "./resource-report.ts";

export const libraries = ["postgres", "fake", "fake2", "@asla/pg"] as const;
export type Library = typeof libraries[number];

export function integer(name: string, value: string, minimum = 1): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum) {
    throw new Error(`--${name} must be a safe integer >= ${minimum}, received ${JSON.stringify(value)}`);
  }
  return number;
}

export function library(value: string): Library {
  const result = libraries.find((name) => name === value);
  if (!result) throw new Error(`Unknown library ${JSON.stringify(value)}; expected ${libraries.join(", ")}`);
  return result;
}

export function filename(name: string): string {
  return name === "@asla/pg" ? "asla-pg" : name;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(promise: Promise<T>, seconds: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${seconds}s`)), seconds * 1000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function loadTarget<T>(test: PoolQueryTest<T>, poolSize: number) {
  const pool = await test.createPool({ poolSize });
  return { query: () => test.select(pool), close: () => test.closePool(pool) };
}

export async function loadLibrary(name: Library, poolSize: number) {
  switch (name) {
    case "postgres":
      return loadTarget((await import("../lib/postgres.ts")).poolQueryTest, poolSize);
    case "fake":
      return loadTarget((await import("./fake.ts")).poolQueryTest, poolSize);
    case "fake2":
      return loadTarget((await import("./fake2.ts")).poolQueryTest, poolSize);
    case "@asla/pg": {
      const { initTest } = await import("./init-asla-pg-test.ts");
      return loadTarget(initTest(await import("@asla/pg")).poolQueryTest, poolSize);
    }
  }
}

interface ResourceCounters {
  succeeded: number;
  failed: number;
  dropped: number;
  inFlight: number;
  concurrency: number;
}

export function createResourceSampler(counters: () => ResourceCounters) {
  const samples: ResourceSample[] = [];
  const startCpu = cpuUsage();
  let previousCpu = startCpu;
  const start = performance.now();
  let previousTime = start;
  let previousSucceeded = 0;
  let previousFailed = 0;
  let previousDropped = 0;

  function sample(now: number): ResourceSample {
    const cpu = cpuUsage();
    const memory = memoryUsage();
    const counts = counters();
    const interval = (now - previousTime) / 1000;
    const value: ResourceSample = {
      seconds: (now - start) / 1000,
      intervalSeconds: interval,
      cpuPercent: interval > 0
        ? (cpu.user + cpu.system - previousCpu.user - previousCpu.system) / (interval * 10000)
        : 0,
      rssMiB: memory.rss / 1024 ** 2,
      heapMiB: memory.heapUsed / 1024 ** 2,
      externalMiB: memory.external / 1024 ** 2,
      successQps: interval > 0 ? (counts.succeeded - previousSucceeded) / interval : 0,
      errorQps: interval > 0 ? (counts.failed - previousFailed) / interval : 0,
      droppedQps: interval > 0 ? (counts.dropped - previousDropped) / interval : 0,
      inFlight: counts.inFlight,
      concurrency: counts.concurrency,
    };
    samples.push(value);
    previousCpu = cpu;
    previousTime = now;
    previousSucceeded = counts.succeeded;
    previousFailed = counts.failed;
    previousDropped = counts.dropped;
    return value;
  }

  sample(start);
  return {
    start,
    sample,
    finish(now: number) {
      sample(now);
      return {
        elapsedSeconds: (now - start) / 1000,
        cpuUs: previousCpu.user + previousCpu.system - startCpu.user - startCpu.system,
        samples,
      };
    },
  };
}

export async function runResourceScenario(options: {
  directory: string;
  script: string;
  selected: readonly Library[];
  args: string[];
  timeout: number;
  description: string;
}): Promise<number> {
  const { directory, script, selected, args, timeout, description } = options;
  await Deno.mkdir(directory, { recursive: true });
  let failures = 0;
  const results: AdaptiveResourceResult[] = [];
  for (const name of selected) {
    console.log(`Running ${name}: ${description}`);
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "-A",
        "--frozen",
        "--no-prompt",
        "--config",
        fileURLToPath(new URL("../deno.json", import.meta.url)),
        fileURLToPath(script),
        ...args,
      ],
      env: { PG_BENCH_WORKER: name, PG_BENCH_OUTPUT: directory },
      stdin: "null",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn();
    let exited = false;
    const statusPromise = child.status.then((status) => {
      exited = true;
      return status;
    });
    try {
      const status = await withTimeout(statusPromise, timeout, `${name} worker PID ${child.pid}`);
      if (!status.success) {
        failures++;
        console.error(`${name} worker exited with code ${status.code}`);
      }
    } catch (error) {
      failures++;
      console.error(error);
    } finally {
      if (!exited) {
        child.kill("SIGKILL");
        await statusPromise;
      }
    }
    try {
      const result: AdaptiveResourceResult = JSON.parse(
        await Deno.readTextFile(resolve(directory, `${filename(name)}.json`)),
      );
      results.push(result);
      console.log(
        `${name}: started=${result.started} succeeded=${result.succeeded} failed=${result.failed} dropped=${result.dropped}`,
      );
      console.log(
        `${name}: searchConverged=${result.searchConverged} searchEnd=${result.searchCompletedAtSeconds}s steady=${
          result.steadyElapsedSeconds.toFixed(2)
        }s steadyQps=${result.steadyAverageQps?.toFixed(1) ?? "unavailable"}`,
      );
      console.log(
        `${name}: average=${result.averageQps.toFixed(1)}/s peak=${
          result.peakQps.toFixed(1)
        }/s peakConcurrency=${result.peakConcurrency}`,
      );
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
      failures++;
      console.error(`${name}: no result file; see worker error above`);
    }
  }
  await Deno.writeTextFile(resolve(directory, "results.json"), JSON.stringify(results, null, 2));
  if (results.length > 0) {
    await Deno.writeTextFile(resolve(directory, "comparison.svg"), await renderResourceChart(results));
  }
  return failures;
}
