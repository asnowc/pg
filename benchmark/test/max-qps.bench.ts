import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { measureAdaptive } from "../utils/adaptive-resource.ts";
import type { AdaptiveResourceResult } from "../utils/resource-report.ts";
import {
  filename,
  integer,
  libraries,
  type Library,
  library,
  loadLibrary,
  runResourceScenario,
  withTimeout,
} from "../utils/resource-runner.ts";

// 自适应搜索的最低并发数。
const MIN_CONCURRENCY = 1;
// 最多同时保留的未完成查询数。
const MAX_CONCURRENCY = 1024;
// 第一轮校准并发；null 表示取连接池大小，并限制在并发上下界内。
const INITIAL_CONCURRENCY: number | null = null;
// 每个基准或探测窗口的时长，单位为秒。
const TUNE_INTERVAL = 2;
// 粗探测要求的最小 QPS 提升百分比；细探测按相对步长缩小阈值。
const MIN_GAIN_PERCENT = 4;
// 等待在途查询排空和连接池关闭的超时时间，单位为秒。
const DRAIN_TIMEOUT = 10;
// 顺序比较的客户端；每个客户端使用独立进程。
const SELECTED_LIBRARIES: readonly Library[] = libraries;
// 报告根目录；每次运行自动创建时间戳子目录。
const OUTPUT_DIRECTORY = fileURLToPath(new URL("../results", import.meta.url));
// 子进程在搜索、后续采样和排空预算之外的退出宽限时间，单位为秒。
const WORKER_EXIT_GRACE = 30;

interface Options {
  poolSize: number;
  steadyDuration: number;
  searchTimeout: number;
}

const values = new Command()
  .name("max-qps.bench.ts")
  .description("Independent-process adaptive max-QPS CPU and memory benchmark")
  .option("--pool-size <count>", "Pool connection limit", integer(1), 4)
  .option(
    "--steady-duration <seconds>",
    "Continue tuning this long after the first local convergence",
    integer(1),
    60,
  )
  .option("--search-timeout <seconds>", "Maximum estimation and search time before failing", integer(1), 120)
  .allowExcessArguments(false)
  .addHelpText(
    "after",
    '\nUses TEST_LOGIN_DB and "select 1 as x". No warmup or target QPS.\nTwo sampled calibration windows estimate a starting concurrency from CPU cost and latency, with a bounded capacity probe.\nConvergence requires five consecutive completed unit-step probes whose candidate concurrencies are neither strictly increasing nor strictly decreasing.\nTuning continues after convergence. Search timeout is a failure, not an estimated optimum.',
  )
  .parse(Deno.args, { from: "user" })
  .opts<Options>();

await main();

async function main() {
  const selected = [...new Set(SELECTED_LIBRARIES.map(library))];
  if (selected.length === 0) throw new Error("SELECTED_LIBRARIES must not be empty");
  const { poolSize, steadyDuration, searchTimeout } = values;

  const minConcurrency = MIN_CONCURRENCY;
  const maxConcurrency = MAX_CONCURRENCY;
  const initialConcurrency = INITIAL_CONCURRENCY ?? Math.min(maxConcurrency, Math.max(minConcurrency, poolSize));
  const tuneInterval = TUNE_INTERVAL;
  const drainTimeout = DRAIN_TIMEOUT;
  const minGainPercent = MIN_GAIN_PERCENT;

  const options = {
    steadyDuration,
    searchTimeout,
    minConcurrency,
    maxConcurrency,
    initialConcurrency,
    tuneInterval,
    minGainPercent,
    drainTimeout,
  };
  const worker = Deno.env.get("PG_BENCH_WORKER");
  if (worker !== undefined) {
    const output = Deno.env.get("PG_BENCH_OUTPUT");
    if (!output) throw new Error("PG_BENCH_OUTPUT is required in a benchmark worker");
    const name = library(worker);
    const target = await loadLibrary(name, poolSize);
    let canClose = true;
    try {
      const measured = await measureAdaptive(target.query, options);
      canClose = measured.drained;
      const result: AdaptiveResourceResult = {
        library: name,
        pid: Deno.pid,
        denoVersion: Deno.version.deno,
        qps: null,
        poolSize,
        maxInFlight: maxConcurrency,
        steadyDuration,
        searchTimeout,
        minConcurrency,
        initialConcurrency,
        tuneInterval,
        minGainPercent,
        ...measured,
      };
      await Deno.writeTextFile(resolve(output, `${filename(name)}.json`), JSON.stringify(result, null, 2));
      if (!result.drained || result.failed > 0 || !result.searchConverged) Deno.exitCode = 1;
    } finally {
      if (canClose) await withTimeout(target.close(), drainTimeout, "Pool close");
    }
    Deno.exit(Deno.exitCode);
  }
  const directory = resolve(
    OUTPUT_DIRECTORY,
    new Date().toISOString().replace(/[:.]/g, "-"),
    `adaptive-pool-${poolSize}`,
  );
  const failures = await runResourceScenario({
    directory,
    script: import.meta.url,
    selected,
    args: [
      "--pool-size",
      String(poolSize),
      "--steady-duration",
      String(steadyDuration),
      "--search-timeout",
      String(searchTimeout),
    ],
    timeout: searchTimeout + steadyDuration + drainTimeout * 2 + WORKER_EXIT_GRACE,
    description: `adaptive max-QPS pool=${poolSize} concurrency=${minConcurrency}-${maxConcurrency}`,
  });
  console.log(`Reports: ${directory}`);
  if (failures > 0) throw new Error(`${failures} worker/report failures; inspect stderr and partial reports`);
}
