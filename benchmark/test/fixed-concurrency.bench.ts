import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { ConcurrencyBench, openFileCollector } from "../deps/bench.ts";
import { filename, integer, libraries, loadLibrary, runResourceScenario } from "../utils/resource-runner.ts";

// 报告根目录；每次运行自动创建时间戳子目录。
const OUTPUT_DIRECTORY = fileURLToPath(new URL("../results", import.meta.url));

interface Options {
  poolSize: number;
  concurrency: number[];
  warmup: number;
  duration: number;
  maxFailures: number;
}

const values = new Command()
  .name("fixed-concurrency.bench.ts")
  .description("Independent-process fixed-concurrency CPU, memory and throughput benchmark")
  .option("--pool-size <count>", "Pool connection limit", integer(1), 4)
  .requiredOption(
    "--concurrency <counts>",
    "Comma-separated outstanding query counts, run in order",
    (value: string) => value.split(",").map(integer(1)),
  )
  .option("--warmup <seconds>", "Warmup duration before measurement", integer(0), 10)
  .option("--duration <seconds>", "Measurement duration for each concurrency", integer(1), 60)
  .option(
    "--max-failures <count>",
    "Allowed query failures across warmup and all stages (stop only when exceeded)",
    integer(0),
    0,
  )
  .allowExcessArguments(false)
  .addHelpText(
    "after",
    '\nUses TEST_LOGIN_DB and "select 1 as x". No target QPS.\nRuns concurrency counts in the supplied order, warming up only the first count.\nCharts exclude warmup and final drain; all raw measurement samples are retained.',
  )
  .parse(Deno.args, { from: "user" })
  .opts<Options>();

await main();

async function main() {
  const { poolSize, concurrency, warmup, duration, maxFailures } = values;

  const options = {
    concurrency,
    warmupDuration: warmup * 1000,
    duration: duration * 1000,
    maxFailures,
  };
  const worker = Deno.env.get("PG_BENCH_WORKER");
  if (worker !== undefined) {
    const output = Deno.env.get("PG_BENCH_OUTPUT");
    if (!output) throw new Error("PG_BENCH_OUTPUT is required in a benchmark worker");
    const name = worker;
    const target = await loadLibrary(name, poolSize);
    try {
      await using collector = await openFileCollector(output, filename(name));
      const result = await new ConcurrencyBench({ ...options, name }).runWidthCpuAndMemory({
        fn: target.query,
        intervalSampleCPUAndMemory: 1000,
        collector,
      });
      await collector.saveResult(result, { library: name, pid: Deno.pid, denoVersion: Deno.version.deno, poolSize });
    } finally {
      await target.close();
    }
    return;
  }
  const directory = resolve(
    OUTPUT_DIRECTORY,
    `fixed-concurrency-${new Date().toISOString().replace(/[:.]/g, "-")}`,
  );
  const failures = await runResourceScenario({
    directory,
    script: import.meta.url,
    selected: libraries,
    args: [
      "--pool-size",
      String(poolSize),
      "--concurrency",
      concurrency.join(","),
      "--warmup",
      String(warmup),
      "--duration",
      String(duration),
      "--max-failures",
      String(maxFailures),
    ],
    description:
      `fixed-concurrency pool=${poolSize} concurrency=${concurrency} warmup=${warmup}s measurement=${duration}s`,
  });
  console.log(`Reports: ${directory}`);
  if (failures > 0) throw new Error(`${failures} worker/report failures; inspect stderr and partial reports`);
}
