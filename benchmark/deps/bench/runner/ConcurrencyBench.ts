import { ConcurrencyBenchConfig } from "../types/bench.ts";
import { ConcurrencyBenchResult } from "../types/bench_result.ts";
import { ConcurrencyBenchSample } from "../types/sample.ts";

export class ConcurrencyBench {
  constructor(public config: ConcurrencyBenchConfig) {}

  createTask(fn: () => Promise<void>): ConcurrencyBenchTask {
    throw new Error("Method not implemented.");
  }
}
export class ConcurrencyBenchTask {
  warmup(): Promise<void> {
    throw new Error("Method not implemented.");
  }
  run(options?: { onFnResult?: (sample: ConcurrencyBenchSample) => void }): Promise<ConcurrencyBenchResult> {
    throw new Error("Method not implemented.");
  }
}
