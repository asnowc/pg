import { loadQueryTargets, reportDirectory, runMemoryBench } from "../utils/bench.ts";

await runMemoryBench({
  directory: reportDirectory("query"),
  targets: await loadQueryTargets(),
  queries: ["select", "selectArg", "selectArgs"],
});
