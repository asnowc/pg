import { getConcurrencyBenchResult, printBenchResult } from "../utils/bench.ts";
import { PoolQueryTest, TestQueries } from "../utils/common.ts";
import { ConcurrencyBench } from "../utils/ConcurrencyBench.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";

await run();

async function run() {
  const libs = await Promise.all([
    import("@asla/pg").then((mod) => initTest(mod)),
    // import("@asla/pg-prev").then((mod) => initTest(mod as any, "@asla/pg-prev")),
    import("../lib/pg.ts"),
    // import("../lib/pgPromise.ts"),
    import("../lib/postgres.ts"),
    // import("../lib/slonik.ts"),
  ]);
  const poolQueryTests = libs.map((item): PoolQueryTest<any> => item.poolQueryTest);

  const queryTests: (keyof TestQueries<unknown>)[] = [
    "select",
    "selectArg",
    "selectArgs",
    // "selectWhere",
  ];
  for (const name of queryTests) {
    const bench = new ConcurrencyBench({ iterations: 10000, warmupIterations: 100 });
    createConcurrencyBench(bench, poolQueryTests);
    const raw = await bench.run();
    console.log(name);
    const result = getConcurrencyBenchResult(raw);
    printBenchResult(result);
  }
}
function createConcurrencyBench(bench: ConcurrencyBench, poolQueryTest: PoolQueryTest<any>[]) {
  for (const info of poolQueryTest) {
    bench.add({
      name: info.name,
      fn: info.select,
      beforeRun: () => {
        return info.createPool({ poolSize: 4 });
      },
      afterRun: (context) => {
        return info.closePool(context);
      },
    });
  }
}
