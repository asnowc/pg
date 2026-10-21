import { setTimeout as delay } from "node:timers/promises";
import { ConcurrencyBench, openFileCollector } from "../../deps/bench.ts";
import { filename, runResourceScenario } from "../../utils/resource-runner.ts";

const worker = Deno.env.get("PG_BENCH_WORKER");
if (worker) {
  const output = Deno.env.get("PG_BENCH_OUTPUT");
  if (!output) throw new Error("Missing worker output directory");
  await using collector = await openFileCollector(output, filename(worker));
  const result = await new ConcurrencyBench({ name: worker, concurrency: [2, 1, 2], duration: 10 })
    .runWidthCpuAndMemory({
      fn: async () => {
        await delay(1);
        if (worker === "postgres" && Deno.args[1] === "true") throw new Error("fixture failure");
      },
      collector,
      intervalSampleCPUAndMemory: 5,
    });
  await collector.saveResult(result, { pid: Deno.pid });
} else {
  const failures = await runResourceScenario({
    directory: Deno.args[0],
    script: import.meta.url,
    selected: ["postgres", "fake2"],
    args: Deno.args,
    description: "Isolated fixture",
  });
  console.log(`failures=${failures}`);
}
