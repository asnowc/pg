import {
  AnalyzedSampleGroup,
  analyzeSampleGroup,
  ConcurrencyBench,
  ConcurrencyBenchSample,
  renderSvg,
} from "../deps/bench.ts";
import { BenchTarget, getReportDirectory } from "../utils/bench.ts";
import { QueryTest } from "../utils/common.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";
import path from "node:path";

function queryTarget<T, P>(info: QueryTest<T, P>): BenchTarget {
  return {
    name: info.name,
    async create(query) {
      const { conn, pool } = await info.connect();
      return { query: () => info[query](conn), close: () => info.close(conn, pool) };
    },
  };
}
const RESULT_DIR = getReportDirectory(import.meta);
const LIBS = await Promise.all([
  import("@asla/pg").then((mod) => queryTarget(initTest(mod).queryTest)),
  import("../lib/pg.ts").then((mod) => queryTarget(mod.queryTest)),
  import("../lib/pgPromise.ts").then((mod) => queryTarget(mod.queryTest)),
  import("../lib/postgres.ts").then((mod) => queryTarget(mod.queryTest)),
  import("../lib/slonik.ts").then((mod) => queryTarget(mod.queryTest)),
]);
const queryNames = ["query1", "query2", "query3"]; // Replace with actual query names

/** 原始数据只在内存中保存；每个查询场景仅输出 SVG。 */
async function run(): Promise<void> {
  let failures = 0;
  for (const queryName of queryNames) {
    const results: AnalyzedSampleGroup[] = [];
    const notes = ["Same-process comparison: retained memory from earlier clients may affect later measurements."];
    for (const target of LIBS) {
      const samples: ConcurrencyBenchSample[] = [];
      const bench = new ConcurrencyBench({
        concurrency: 500,
        warmupDuration: 2,
        duration: 5,
        name: target.name,
      });
      const queryFn = await target.create(queryName);
      const run = await bench.runWidthCpuAndMemory({
        fn: queryFn.query,
        intervalSampleCPUAndMemory: 1000,
        collector: samples,
      });

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
      await queryFn.close();
    }
    await renderSvg({ path: path.resolve(RESULT_DIR, `${queryName}.svg`), title: queryName, results, notes });
  }
  console.log(`Reports: ${RESULT_DIR}`);
  if (failures) throw new Error(`${failures} benchmark failures; inspect the SVG reports and stderr`);
}
await run();
