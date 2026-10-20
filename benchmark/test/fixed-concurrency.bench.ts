import { Command } from "commander";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { measureFixed } from "../utils/fixed-resource.ts";
import type { ResourceResult } from "../utils/resource-report.ts";
import {
  filename,
  integer,
  libraries,
  type Library,
  loadLibrary,
  runResourceScenario,
} from "../utils/resource-runner.ts";

// 报告根目录；每次运行自动创建时间戳子目录。
const OUTPUT_DIRECTORY = fileURLToPath(new URL("../results", import.meta.url));

interface Options {
  poolSize: number;
  concurrency: number[];
  warmup: number;
  duration: number;
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
  .allowExcessArguments(false)
  .addHelpText(
    "after",
    '\nUses TEST_LOGIN_DB and "select 1 as x". No target QPS.\nRuns concurrency counts in the supplied order, warming up only the first count.\nCharts use a continuous timeline with per-stage averages excluding warmup and final drain.\nTotal sampling time = warmup + duration * number of concurrency counts.',
  )
  .parse(Deno.args, { from: "user" })
  .opts<Options>();

await main();

async function main() {
  const { poolSize, concurrency, warmup, duration } = values;

  const options = {
    concurrency,
    warmup,
    duration,
  };
  const worker = Deno.env.get("PG_BENCH_WORKER");
  if (worker !== undefined) {
    const output = Deno.env.get("PG_BENCH_OUTPUT");
    if (!output) throw new Error("PG_BENCH_OUTPUT is required in a benchmark worker");
    const name = worker as Library;
    const target = await loadLibrary(name, poolSize);
    try {
      const measured = await measureFixed(target.query, options);
      const result: ResourceResult = {
        library: name,
        pid: Deno.pid,
        denoVersion: Deno.version.deno,
        qps: null,
        poolSize,
        maxInFlight: Math.max(...concurrency),
        concurrency,
        warmup,
        duration,
        ...measured,
      };
      await Deno.writeTextFile(resolve(output, `${filename(name)}.json`), JSON.stringify(result, null, 2));
      if (result.failed > 0) Deno.exitCode = 1;
    } finally {
      await target.close();
    }
    Deno.exit(Deno.exitCode);
  }
  const directory = resolve(
    OUTPUT_DIRECTORY,
    new Date().toISOString().replace(/[:.]/g, "-"),
    `fixed-pool-${poolSize}-concurrency-${concurrency.join("-")}`,
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
    ],
    description:
      `fixed-concurrency pool=${poolSize} concurrency=${concurrency} warmup=${warmup}s measurement=${duration}s`,
  });
  console.log(`Reports: ${directory}`);
  if (failures > 0) throw new Error(`${failures} worker/report failures; inspect stderr and partial reports`);
}
