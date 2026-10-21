import { poolTarget, reportDirectory, runMemoryBench } from "../utils/bench.ts";
import { initTest } from "../utils/init-asla-pg-test.ts";

await runMemoryBench({
  directory: reportDirectory("pool-query"),
  targets: await Promise.all([
    import("../lib/postgres.ts").then((mod) => poolTarget(mod.poolQueryTest)),
    import("../utils/fake.ts").then((mod) => poolTarget(mod.poolQueryTest)),
    import("../utils/fake2.ts").then((mod) => poolTarget(mod.poolQueryTest)),
    import("@asla/pg").then((mod) => poolTarget(initTest(mod).poolQueryTest)),
    import("@asla/pg").then((mod) => poolTarget(initTest(mod, "@asla/pg-node", true).poolQueryTest)),
  ]),
  queries: ["select"],
});
