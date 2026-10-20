import { BenchConfig } from "../types/bench.ts";
import type { BenchResult } from "../types/bench_result.ts";

export class Bench {
  constructor(public config: BenchConfig) {}
  warmup<T = void>(fn: (context: T) => unknown, context: T): void {
    throw new Error("Method not implemented.");
  }
  run<T = void>(fn: (context: T) => unknown, context: T): BenchResult {
    throw new Error("Method not implemented.");
  }
}
