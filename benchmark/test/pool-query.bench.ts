import { Bench } from "tinybench";
import { getSortedResult } from "../utils/bench.ts";
import { addPoolQueryBench, PoolQueryTest, TestQueries } from "../utils/common.ts";

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
    const bench = createBench({ poolSize: 4, concurrency: 10000, poolQueryTest: poolQueryTests, name });
    await bench.run();
    console.log(bench.name);
    console.table(getSortedResult(bench));
  }
}
function createBench(
  options: {
    poolSize: number;
    concurrency: number;
    poolQueryTest: PoolQueryTest<unknown>[];
    name: keyof TestQueries<unknown>;
  },
) {
  const { poolSize, concurrency, poolQueryTest, name } = options;
  const bench = new Bench({ warmup: false, name, iterations: 1, time: 0 });
  for (const info of poolQueryTest) {
    addPoolQueryBench({ bench, concurrency, poolSize, benchFn: info.select, poolHandler: info });
  }
  return bench;
}
