import { getConcurrencyBenchResult, printBenchResult } from "../utils/bench.ts";
import { QueryTest, TestQueries } from "../utils/common.ts";
import { ConcurrencyBench } from "../utils/ConcurrencyBench.ts";
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
      maxConcurrency: 500,
      warmupIterations: 100,
      iterations: 2000,
    });
    for (const info of tests) {
      const benchFn = info[name];
      let context: any;
      bench.add({
        name: info.name,
        fn: () => benchFn(context.conn),
        afterRun: async () => {
          await info.close(context.conn, context.pool);
        },
        beforeRun: async () => {
          context = await info.connect();
        },
      });
    }
    const raw = await bench.run();
    console.log(name);
    const result = getConcurrencyBenchResult(raw);
    printBenchResult(result);
  }
}
