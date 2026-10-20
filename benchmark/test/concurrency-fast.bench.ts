import { ConcurrencyBench, ConcurrencyBenchResult, ConcurrencyBenchSample } from "../deps/bench.ts";
import { QueryTest, TestQueries } from "../utils/common.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";
import { cpuUsage, memoryUsage } from "node:process";

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
      const sampleIntervalData: (NodeJS.CpuUsage & NodeJS.MemoryUsage)[] = [];
      const samples: ConcurrencyBenchSample[] = [];

      const benchFn = info[name];
      const context = await info.connect();

      const taskRunner = bench.createTask(() => benchFn(context));
      await taskRunner.warmup();
      const id = setInterval(() => {
        sampleIntervalData.push({ ...cpuUsage(), ...memoryUsage() });
      }, 1000);
      const result = await taskRunner.run({
        onFnResult: (sample) => samples.push(sample),
      }).finally(() => {
        clearInterval(id);
      });
      results.push(result);
      await info.close(context.conn, context.pool);
    }
  }
}
