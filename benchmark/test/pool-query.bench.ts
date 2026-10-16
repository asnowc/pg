import { PoolQueryTest, TestQueries } from "../utils/common.ts";
import { Bench, BenchCustomOptions, getResult } from "../utils/customBench.ts";

await run();

async function run() {
  const libs = await Promise.all([
    import("../lib/asla-pg.ts"),
    import("../lib/pg.ts"),
    import("../lib/pgPromise.ts"),
    import("../lib/postgres.ts"),
    import("../lib/slonik.ts"),
  ]);
  const poolQueryTests = libs.map((item): PoolQueryTest<any> => item.poolQueryTest);

  const queryTests: (keyof TestQueries<unknown>)[] = [
    "select",
    "selectArg",
    "selectArgs",
    // "selectWhere",
  ];
  for (const name of queryTests) {
    const bench = createBench({ iterations: 10000, warmupIterations: 1000 }, poolQueryTests);
    const result = await bench.run();
    console.log(name);
    console.table(getResult(result));
  }
}
function createBench(options: BenchCustomOptions, poolQueryTest: PoolQueryTest<any>[]) {
  const bench = new Bench(options);
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
  return bench;
}
