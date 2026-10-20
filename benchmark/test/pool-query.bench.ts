import { getConcurrencyBenchResult, printBenchResult } from "../utils/bench.ts";
import { PoolQueryTest, TestQueries } from "../utils/common.ts";
import { ConcurrencyBench } from "../utils/ConcurrencyBench.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";

await run();

async function run() {
  const libs = await Promise.all([
    import("../lib/postgres.ts"),
    // import("../lib/pg.ts"),
    // import("@asla/pg-prev").then((mod) => initTest(mod as any, "@asla/pg-prev")),
    import("../utils/fake.ts"),
    import("../utils/fake2.ts"),
    import("@asla/pg").then((mod) => initTest(mod)),
    import("@asla/pg").then((mod) => initTest(mod, "@asla/pg-node", true)),
    // import("../lib/pgPromise.ts"),
    // import("../lib/slonik.ts"),
  ]);
  const poolQueryTests = libs.map((item): PoolQueryTest<any> => item.poolQueryTest);

  const queryTests: (keyof TestQueries<unknown>)[] = [
    "select",
    // "selectArg",
    // "selectArgs",
    // "selectWhere",
  ];
  for (const name of queryTests) {
    const bench = new ConcurrencyBench({ iterations: 50000, warmupIterations: 100 });
    createConcurrencyBench(bench, poolQueryTests, name);
    const raw = await bench.run();
    console.log(name);
    const result = getConcurrencyBenchResult(raw);
    printBenchResult(result);
  }
}
function createConcurrencyBench(
  bench: ConcurrencyBench,
  poolQueryTest: PoolQueryTest<any>[],
  queryName: keyof TestQueries<unknown>,
) {
  for (const info of poolQueryTest) {
    bench.add({
      name: info.name,
      fn: info[queryName],
      beforeRun: () => {
        return info.createPool({ poolSize: 4 });
      },
      afterRun: (context) => {
        return info.closePool(context);
      },
    });
  }
}
