import { GetBenchItem, runUserBench, UserBenchConfig } from "../deps/bench.ts";
import { getReportDirectory, QueryName } from "../utils/common.ts";
import { Library, loadLibrary } from "../utils/resource-runner.ts";

const RESULT_DIR = getReportDirectory(import.meta);

type Meta = { poolSize: number; queryName: QueryName };

export const BENCH_CONFIG: UserBenchConfig = {
  benchName: "PostgreSQL client query",
  duration: 1200,
  concurrency: [25, 100, 200, 400],
  intervalSample: 500,
  warmupDuration: 100,
  benchDataDir: RESULT_DIR,
};
const queryNames: QueryName[] = [
  // "select",
  "selectArg",
  // "selectArgs",
];
export const SERIES: Library[] = [
  "@asla/pg",
  "@asla/pg-node",
  "postgres",
  "pg",
  // "fake2",
];
export const META: Meta = { poolSize: 4, queryName: "select" };

const getBatch: GetBenchItem<Meta> = async function getBatch(name: string, meta: Meta) {
  const { poolSize, queryName } = meta;
  const lib = await loadLibrary(name);
  const pool = await lib.createPool({ poolSize });
  const queryFn = lib[queryName].bind(undefined, pool);

  return {
    fn: queryFn,
    close: () => lib.closePool(pool),
  };
};
export default getBatch;

if (import.meta.main) {
  for (const queryName of queryNames) {
    await runUserBench<Meta>(BENCH_CONFIG, {
      series: SERIES,
      getBenchItem: getBatch,
      meta: { poolSize: 4, queryName },
    });
  }
}
