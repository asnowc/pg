import { Bench } from "tinybench";
import { getSortedResult } from "../utils/bench.ts";
import { addQueryBench, QueryTest, TestQueries } from "../utils/common.ts";

await run();

async function run() {
  const libs = await Promise.all([
    import("../lib/asla-pg.ts"),
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
    "selectWhere",
  ];
  for (const name of queryTests) {
    const bench = new Bench({
      name,
      time: 500,
      iterations: 5000,
      warmup: false, // 由 addQueryBench 控制预热
    });

    for (const info of tests) {
      const benchFn = info[name];
      addQueryBench({ bench, benchFn, hook: info, warmupTime: 100 });
    }
    await bench.run();
    console.log(bench.name);
    console.table(getSortedResult(bench));
  }
}
