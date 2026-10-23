import { GetBenchItem, runUserBench } from "../deps/bench/run.ts";
import { getReportDirectory, QueryName } from "../utils/common.ts";
import { Library, loadLibrary } from "../utils/resource-runner.ts";

const RESULT_DIR = getReportDirectory(import.meta);

const queryNames: QueryName[] = [
  "select",
  // "selectArg",
  // "selectArgs",
  // "selectWhere",
];
const libs: Library[] = [
  "@asla/pg",
  // "@asla/pg-node",
  "postgres",
  // "pg",
  // "fake2",
];
export const getBench: GetBenchItem<{ poolSize: number }, { name: string; queryName: QueryName }> = async function (
  target,
  meta,
) {
  const { name, queryName } = target;
  const { poolSize } = meta;
  const lib = await loadLibrary(name);
  const pool = lib.createPool({ poolSize });
  const queryFn = lib[queryName].bind(lib);

  return {
    fn: queryFn,
    close: () => lib.closePool(pool),
  };
};
for (const queryName of queryNames) {
  await runUserBench({
    benchName: "concurrency-fast",
    duration: 3000,
    concurrency: [100, 250, 500],
    intervalSample: 500,
    benchDataDir: RESULT_DIR,
    gc: true,
    warmupDuration: 100,
    series: libs.map((name) => ({ name, queryName })),
    getBenchItem: getBench,
    meta: { poolSize: 4 },
  });
}
