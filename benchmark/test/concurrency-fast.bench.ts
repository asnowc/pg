import {
  analyzeSampleGroup,
  BenchCollector,
  ConcurrencyBench,
  ConcurrencyBenchSample,
  renderSvg,
} from "../deps/bench.ts";
import { getReportDirectory, QueryTest, TestQueries } from "../utils/common.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";

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
    const collector = new BenchCollector(RESULT_DIR);
    console.log("result saving to", RESULT_DIR);
    for (const target of LIBS) {
      const samples: ConcurrencyBenchSample[] = [];
      const bench = new ConcurrencyBench({
        concurrency: [100, 500],
        warmupDuration: 100,
        duration: 2000,
        name: target.name,
      });
      const conn = await target.connect();
      const queryFn = target[queryName].bind(target);
      console.log("running benchmark for", target.name, "\n");
      const result = await bench.runWidthCpuAndMemory({
        fn: () => queryFn(conn),
        intervalSampleCPUAndMemory: 1000,
        collectorSuccess: samples,
        collectorFailed: {
          push: () => {
            console.log("Failed sample");
          },
        },
      });

      await Promise.allSettled([
        collector.saveSampleFile(target.name, samples),
        collector.saveBenchResult(target.name, result),
        target.close(conn),
      ]);
    }
  }
}
await run();
