import {
  analyzeSampleGroup,
  ConcurrencyBench,
  ConcurrencyBenchResultWithCPUAndMemory,
  ConcurrencyBenchSample,
  renderSvg,
} from "../deps/bench.ts";
import { getReportDirectory, QueryTest, TestQueries } from "../utils/common.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";
import path from "node:path";

const RESULT_DIR = getReportDirectory(import.meta);
const LIBS: QueryTest<any>[] = await Promise.all([
  import("@asla/pg").then((mod) => initTest(mod).queryTest),
  import("../client/pg.ts").then((mod) => mod.queryTest),
  // import("../client/pgPromise.ts").then((mod) => mod.queryTest),
  // import("../client/postgres.ts").then((mod) => mod.queryTest),
  // import("../client/slonik.ts").then((mod) => mod.queryTest),
]);
const queryNames: (keyof TestQueries<any>)[] = [
  "select",
  // "selectArg",
  // "selectArgs",
  // "selectWhere",
];

/** 原始数据只在内存中保存；每个查询场景仅输出 SVG。 */
async function run(): Promise<void> {
  for (const queryName of queryNames) {
    const results: {
      name: string;
      samples: ConcurrencyBenchSample[];
      result: ConcurrencyBenchResultWithCPUAndMemory;
    }[] = [];
    for (const target of LIBS) {
      const samples: ConcurrencyBenchSample[] = [];
      const bench = new ConcurrencyBench({
        concurrency: 500,
        warmupDuration: 100,
        duration: 2000,
        name: target.name,
      });
      const conn = await target.connect();
      const queryFn = target[queryName].bind(target);
      const result = await bench.runWidthCpuAndMemory({
        fn: () => queryFn(conn),
        intervalSampleCPUAndMemory: 1000,
        collectorSuccess: samples,
        collectorFailed: samples,
      });

      results.push({ name: target.name, samples, result });
      await target.close(conn);
    }
    results.map(({ name, result, samples }) => {
      analyzeSampleGroup({ samples, intervalSamples: result, startTime: result.startTime, endTime: result.endTime });
    });
    console.log(`Results for query: ${queryName}`);
  }
  console.log(`Reports: ${RESULT_DIR}`);
}
await run();
