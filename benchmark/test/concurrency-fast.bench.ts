import { ConcurrencyBench, ConcurrencyBenchResult } from "../deps/bench.ts";
import type { ConcurrencyBenchSample } from "../deps/bench/types/sample.ts";
import { QueryTest, TestQueries } from "../utils/common.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";

await run();

async function run() {
  const libs = await Promise.all([
    import("@asla/pg").then((mod) => initTest(mod)),
    import("@asla/pg-prev").then((mod) => initTest(mod as any)),
    import("../lib/pg.ts"),
    import("../lib/pgPromise.ts"),
    import("../lib/postgres.ts"),
    import("../lib/slonik.ts"),
  ]);
  const tests = libs.map((item): QueryTest<any, any> => item.queryTest);

  const queryTests: (keyof TestQueries<unknown>)[] = [
    "select",
    "selectArg",
    "selectArgs",
    // "selectWhere",
  ];

  for (const name of queryTests) {
    const bench = new ConcurrencyBench({
      concurrency: 500,
      duration: 5000,
      warmupDuration: 1000,
    });

    const results: ConcurrencyBenchResult[] = [];
    for (const info of tests) {
      const benchFn = info[name];
      const context = await info.connect();
      const samples = new Array<ConcurrencyBenchSample>();
      const result = await bench.runWidthCpuAndMemory({
        fn: () => benchFn(context),
        intervalSampleCPUAndMemory: 1000,
        collector: samples,
      });
      results.push(result);
      await info.close(context.conn, context.pool);
    }
  }
}
