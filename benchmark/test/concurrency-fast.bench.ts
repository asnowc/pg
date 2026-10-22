import { BenchCollector, ConcurrencyBench, ConcurrencyBenchSample } from "../deps/bench.ts";
import { genResultSvgFromResultDir } from "../deps/bench/reporter/FileDataReporter.ts";
import { getReportDirectory, QueryTest, TestQueries } from "../utils/common.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";

const RESULT_DIR = getReportDirectory(import.meta);
const LIBS: QueryTest<any>[] = await Promise.all([
  import("@asla/pg").then((mod) => initTest(mod).queryTest),
  import("../client/pg.ts").then((mod) => mod.queryTest),
  // import("../client/pgPromise.ts").then((mod) => mod.queryTest),
  import("../client/postgres.ts").then((mod) => mod.queryTest),
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
  const resultsDirInfo: { dir: string; names: string[] }[] = [];
  for (const queryName of queryNames) {
    const dir = RESULT_DIR + "-" + queryName;
    const collector = new BenchCollector(dir);
    console.log("result saving to", dir);
    const result: typeof resultsDirInfo[number] = { dir, names: LIBS.map((lib) => lib.name) };
    resultsDirInfo.push(result);
    for (const target of LIBS) {
      const benchName = `${target.name}-${queryName}`;
      const samples: ConcurrencyBenchSample[] = [];
      const bench = new ConcurrencyBench({
        concurrency: [100, 250, 500],
        warmupDuration: 100,
        duration: 3000,
        name: target.name,
      });
      console.log("\n");
      if (globalThis.gc) {
        console.log("running gc");
        globalThis.gc?.();
      }
      const conn = await target.connect();
      const queryFn = target[queryName].bind(target);
      console.log("running benchmark for", benchName);
      const result = await bench.runWidthCpuAndMemory({
        fn: () => queryFn(conn),
        intervalSampleCPUAndMemory: 500,
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

  for (const item of resultsDirInfo) {
    console.log("Generating SVG");
    const svgPath = await genResultSvgFromResultDir(item.dir, item.names);
    console.log("Generated SVG at", svgPath);
  }
}

await run();
