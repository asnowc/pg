export interface ConcurrencyBenchOptions {
  warmupIterations?: number;
  iterations: number;
  /** 最大并发数，默认为 iterations  */
  maxConcurrency?: number;
}
export class ConcurrencyBench {
  constructor(private config: ConcurrencyBenchOptions) {
  }
  #case: BenchTask<any>[] = [];
  add<T>(config: BenchTask<T>): void {
    this.#case.push(config);
  }
  async run(): Promise<BenchTaskSample[]> {
    const result: BenchTaskSample[] = [];
    const { iterations, warmupIterations = 0, maxConcurrency = iterations } = this.config;
    for (const benchTarget of this.#case) {
      const { beforeRun, afterRun } = benchTarget;
      let context: any;
      if (beforeRun) {
        context = await beforeRun();
      }
      if (warmupIterations > 0) {
        await this.runCase(benchTarget, context, warmupIterations, maxConcurrency);
      }
      const caseResult = await this.runCase(benchTarget, context, iterations, maxConcurrency);
      result.push(caseResult);
      if (afterRun) await afterRun(context);
    }
    return result;
  }
  private async runCase<T>(
    benchTarget: BenchTask<T>,
    context: T,
    iterations: number,
    maxConcurrency: number,
  ): Promise<BenchTaskSample> {
    const { fn } = benchTarget;
    const data: BenchTaskSample["sampleData"] = new Array(iterations);
    let resolveCount = 0;
    let erroredCount = 0;

    async function work() {
      while (true) {
        const index = resolveCount++;
        if (index >= iterations) return;

        let errored = false;
        const start = performance.now();
        try {
          await fn(context);
        } catch {
          errored = true;
          erroredCount++;
        }
        data[index] = { start, end: performance.now(), errored };
      }
    }
    const timeStart = performance.now();
    const tasks: Promise<void>[] = [];
    for (let i = 0; i < maxConcurrency; i++) {
      tasks.push(work());
    }
    await Promise.all(tasks);
    return {
      taskName: benchTarget.name,
      start: timeStart,
      end: performance.now(),
      sampleData: data,
      iterations,
      erroredCount,
    };
  }
}

export interface BenchTaskSample {
  taskName: string;
  start: number;
  end: number;
  erroredCount: number;
  sampleData: { start: number; end: number; errored?: boolean }[];
  iterations: number;
}
export interface BenchTask<T = unknown> {
  name: string;
  fn: (context: T) => Promise<void>;
  /** 运行之前执行，预热和运行之前只会运行一次 */
  beforeRun?: () => Promise<T>;
  /** 运行之后执行，预热和运行之后只会运行一次 */
  afterRun?: (context: T) => Promise<void>;
}
