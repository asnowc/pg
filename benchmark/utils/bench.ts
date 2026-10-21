import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import path from "node:path";
import {
  type AnalyzedSampleGroup,
  analyzeSampleGroup,
  type BenchInput,
  ConcurrencyBench,
  type ConcurrencyBenchSample,
  renderSvg,
} from "../deps/bench.ts";
import type { PoolQueryTest, QueryTest, TestQueries } from "./common.ts";
import { initTest } from "./init-asla-pg-test.ts";

export const DEFAULT_BENCH_INPUT = {
  concurrency: [100, 250, 500],
  duration: 3000,
  warmupDuration: 1000,
} satisfies BenchInput;
/** 报告根目录；每个脚本一次运行共用一个目录。 */
export const OUTPUT_DIRECTORY = fileURLToPath(new URL("../results", import.meta.url));

export function reportDirectory(name: string) {
  return resolve(OUTPUT_DIRECTORY, `${name}-${new Date().toISOString().replace(/[:.]/g, "-")}`);
}
export function getReportDirectory(meta: ImportMeta) {
  const base = path.resolve(import.meta.dirname!, "../results");
  return path.join(base, path.parse(meta.filename!).name + reportDirectory(meta.filename!));
}
type QueryName = keyof TestQueries<unknown>;
export type BenchTarget = {
  name: string;
  create(query: QueryName): Promise<{ query: () => Promise<void>; close: () => Promise<void> }>;
};

export function queryTarget<T, P>(info: QueryTest<T, P>): BenchTarget {
  return {
    name: info.name,
    async create(query) {
      const { conn, pool } = await info.connect();
      return { query: () => info[query](conn), close: () => info.close(conn, pool) };
    },
  };
}

export function poolTarget<T>(info: PoolQueryTest<T>, poolSize = 4): BenchTarget {
  return {
    name: info.name,
    async create(query) {
      const pool = await info.createPool({ poolSize });
      return { query: () => info[query](pool), close: () => info.closePool(pool) };
    },
  };
}

export async function loadQueryTargets(): Promise<BenchTarget[]> {
  const previousPath = new URL("../../dist/mod.js", import.meta.url);
  try {
    await access(previousPath);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
    throw new Error("@asla/pg-prev requires the previous version's dist/mod.js; provide that artifact before running", {
      cause: error,
    });
  }
  const previous: typeof import("@asla/pg") = await import(previousPath.href);
  if (typeof previous.connect !== "function" || typeof previous.PgPool !== "function") {
    throw new Error("@asla/pg-prev does not expose the connection/pool API required by this benchmark");
  }
  return Promise.all([
    import("@asla/pg").then((mod) => queryTarget(initTest(mod).queryTest)),
    Promise.resolve(queryTarget(initTest(previous, "@asla/pg-prev").queryTest)),
    import("../lib/pg.ts").then((mod) => queryTarget(mod.queryTest)),
    import("../lib/pgPromise.ts").then((mod) => queryTarget(mod.queryTest)),
    import("../lib/postgres.ts").then((mod) => queryTarget(mod.queryTest)),
    import("../lib/slonik.ts").then((mod) => queryTarget(mod.queryTest)),
  ]);
}

/** 原始数据只在内存中保存；每个查询场景仅输出 SVG。 */
export async function runMemoryBench(options: {
  directory: string;
  targets: BenchTarget[];
  queries: QueryName[];
  input?: BenchInput;
}): Promise<void> {
  let failures = 0;
  for (const queryName of options.queries) {
    const results: AnalyzedSampleGroup[] = [];
    const notes = ["Same-process comparison: retained memory from earlier clients may affect later measurements."];
    for (const target of options.targets) {
      try {
        const resource = await target.create(queryName);
        try {
          const samples: ConcurrencyBenchSample[] = [];
          const run = await new ConcurrencyBench({
            ...options.input ?? DEFAULT_BENCH_INPUT,
            name: target.name,
          }).runWidthCpuAndMemory({ fn: resource.query, intervalSampleCPUAndMemory: 1000, collector: samples });
          results.push(analyzeSampleGroup({
            sampleGroup: {
              name: target.name,
              startTime: run.intervalSampleData[0].timestamp,
              endTime: run.intervalSampleData.at(-1)!.timestamp,
              sampleCount: samples.length,
              samples,
            },
            intervalSamples: run,
          }));
          const failed = samples.filter((sample) => !sample[2]).length;
          console.log(`${queryName}/${target.name}: success=${samples.length - failed} failed=${failed}`);
        } finally {
          await resource.close();
        }
      } catch (error) {
        const message = `${queryName}/${target.name}: ${String(error)}`;
        console.error(message);
        notes.push(message);
        failures++;
      }
    }
    await renderSvg({ path: resolve(options.directory, `${queryName}.svg`), title: queryName, results, notes });
  }
  console.log(`Reports: ${options.directory}`);
  if (failures) throw new Error(`${failures} benchmark failures; inspect the SVG reports and stderr`);
}
