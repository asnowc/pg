export interface BenchCustomOptions {
  warmupIterations?: number;
  iterations: number;
  /** 最大并发数，默认无限 */
  // maxConcurrency?: number;
}
export class Bench {
  constructor(private config: BenchCustomOptions) {
  }
  #case: BenchFn<any>[] = [];
  add<T>(config: BenchFn<T>): void {
    this.#case.push(config);
  }
  async run(): Promise<Map<string, BenchRawResult>> {
    const result = new Map<string, BenchRawResult>();
    const { iterations, warmupIterations = 0 } = this.config;
    for (const benchTarget of this.#case) {
      const { beforeRun, afterRun } = benchTarget;
      let context: any;
      if (beforeRun) context = await beforeRun();
      if (warmupIterations > 0) {
        const result = await this.runCase(benchTarget, context, warmupIterations);
        if (result === null) {
          continue;
        }
      }
      const caseResult = await this.runCase(benchTarget, context, iterations);
      if (caseResult === null) {
        console.error(`Benchmark iteration for ${benchTarget.name} failed.`);
        continue;
      }
      result.set(benchTarget.name, caseResult);
      if (afterRun) await afterRun(context);
    }
    for (const item of result.values()) {
      item.sortedSampleData.sort((a, b) => a - b);
    }
    return result;
  }
  private runCase<T>(benchTarget: BenchFn<T>, context: T, iterations: number): Promise<BenchRawResult | null> {
    return new Promise<BenchRawResult | null>((resolve) => {
      const { fn } = benchTarget;
      const timeStart = performance.now();
      let errored = false;
      const data: number[] = new Array(iterations);
      let resolveCount = 0;
      const getResult = () => {
        if (++resolveCount < iterations) return;

        const endTime = performance.now();
        resolve(
          errored ? null : {
            start: timeStart,
            end: endTime,
            sortedSampleData: data,
            errored,
            iterations,
          },
        );
      };
      for (let i = 0; i < iterations; i++) {
        fn(context).then(
          () => {
            data[i] = performance.now();
            getResult();
          },
          () => {
            errored = true;
            getResult();
          },
        );
      }
    });
  }
}
export function getResult(cases: Map<string, BenchRawResult>): Partial<BenchResult>[] {
  const results: BenchResult[] = [];
  const erroredCases: Partial<BenchResult>[] = [];
  for (const [name, benchCase] of cases) {
    if (benchCase === null) {
      erroredCases.push({ name });
      continue;
    }
    results.push(calcResult(name, benchCase));
  }
  results.sort((a, b) => a.totalTime - b.totalTime);
  const slowest = results[results.length - 1].totalTime;
  for (let i = 0; i < results.length; i++) {
    const ratio = slowest / results[i].totalTime;
    results[i].ratio = ratio.toFixed(2) + "X";
  }
  return [...results, ...erroredCases];
}
function calcResult(name: string, data: BenchRawResult): BenchResult {
  const sortedData = data.sortedSampleData;
  const iterations = data.iterations;
  const totalTime = data.end - data.start;
  const avg = sortedData.reduce((a, b) => a + b, 0) / iterations;
  const min = sortedData[0];
  const max = sortedData[iterations - 1];
  return {
    name,
    ratio: "",
    totalTime,
    avg,
    min,
    max,
    p50: getPercent(sortedData, 0.5),
    p75: getPercent(sortedData, 0.75),
    p99: getPercent(sortedData, 0.99),
    p999: getPercent(sortedData, 0.999),
  };
}
function getPercent(sortedData: number[], percent: number) {
  return sortedData[Math.floor(sortedData.length * percent)];
}
export interface BenchRawResult {
  start: number;
  end: number;
  sortedSampleData: number[];
  errored: boolean;
  iterations: number;
}
export interface BenchFn<T = unknown> {
  name: string;
  fn: (context: T) => Promise<void>;
  /** 运行之前执行，预热和运行之前只会运行一次 */
  beforeRun?: () => Promise<T>;
  /** 运行之后执行，预热和运行之后只会运行一次 */
  afterRun?: (context: T) => Promise<void>;
}
export interface BenchResult {
  name: string;
  ratio: string;
  totalTime: number;
  avg: number;

  min: number;
  max: number;
  p50: number;
  p75: number;
  p99: number;
  p999: number;
}
