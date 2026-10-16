import { Bench } from "tinybench";
import { BenchTaskSample } from "./ConcurrencyBench.ts";

export type BenchResultData = {
  name: string;
  erroredCount: number;
  totalTime: number;
  min: number;
  max: number;
  /** 平均耗时 */
  mean: number;
  p50: number;
  p75: number;
  p99: number;
  rme: number;
  /** 样本数量 */
  samplesNumber: number;

  state: "completed";
};
export type BenchResult = BenchResultData | {
  name: string;
  state: "failed";
};
/**
 * 获取排序后的基准测试结果。排序顺序为，最快 -> 最慢 -> 无结果。无论是否翻转，无结果始终排在最后。
 */
export function printBenchResult(input: BenchResult[]): void {
  const compiledResults = input.filter((result) => result.state === "completed");
  const unknownResults = input.filter((result) => result.state === "failed");
  const sortedResult = compiledResults.sort((left, right) => left.totalTime - right.totalTime);

  const results2 = unknownResults.map((result): Partial<BenchResult> => {
    return { name: result.name };
  });
  const ratio = new Array<number>(sortedResult.length);

  const baseline = sortedResult[sortedResult.length - 1].totalTime;
  for (let i = 0; i < sortedResult.length; i++) {
    ratio[i] = baseline / sortedResult[i].totalTime;
  }
  const dt = "ms";
  const result = [
    ...sortedResult.map((result, index) => ({
      [`name >>【${dt}】`]: result.name,
      ratio: ratio[index].toFixed(2) + "X",
      totalTime: floor(result.totalTime, 0),
      mean: result.mean.toFixed(5) + " ±" + result.rme.toFixed(2) + "%",
      min: floor(result.min, 5),
      max: floor(result.max, 5),
      p50: floor(result.p50, 5),
      p75: floor(result.p75, 5),
      p99: floor(result.p99, 5),
      "samples (success/error)": `${result.samplesNumber} / ${result.erroredCount}`,
    })),
    ...results2,
  ];
  console.table(result);
}

function floor(value: number, x: number) {
  const c = 10 ** x;
  return Math.floor(value * c) / c;
}

export function getConcurrencyBenchResult(cases: BenchTaskSample[]): BenchResultData[] {
  const result: BenchResultData[] = new Array(cases.length);
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    const duration = item.sampleData.map((d) => d.end - d.start).sort((a, b) => a - b);
    const mean = duration.reduce((a, b) => a + b, 0) / item.iterations;
    result[i] = {
      name: item.taskName,
      state: "completed",
      erroredCount: item.erroredCount,
      totalTime: item.end - item.start,
      min: duration[0],
      max: duration[duration.length - 1],
      mean,
      p50: getPercent(duration, 0.5),
      p75: getPercent(duration, 0.75),
      p99: getPercent(duration, 0.99),
      rme: calcRme(duration, mean),
      samplesNumber: item.iterations,
    };
  }
  return result;
}
function getPercent(sortedData: number[], percent: number) {
  const index = Math.ceil(sortedData.length * percent) - 1;
  return sortedData[index];
}
function calcRme(data: number[], mean: number) {
  const squaredDiffs = data.map((value) => (value - mean) ** 2);
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / (data.length - 1);
  const standardDeviation = Math.sqrt(variance);
  return (standardDeviation / mean) * 100;
}

export function getTinyBenchBenchResult(bench: Bench): BenchResult[] {
  const total = bench.results.length;
  const results = new Array<BenchResult>(total);
  for (let i = 0; i < total; i++) {
    const result = bench.results[i];
    const task = bench.tasks[i];
    if (result.state === "completed") {
      results[i] = {
        name: task.name,
        state: "completed",
        erroredCount: 0,
        totalTime: result.totalTime,
        min: result.latency.min,
        max: result.latency.max,
        mean: result.latency.mean,
        p50: result.latency.p50,
        p75: result.latency.p75,
        p99: result.latency.p99,
        rme: result.latency.rme,
        samplesNumber: result.latency.samplesCount,
      };
    } else {
      results[i] = {
        state: "failed",
        name: task.name,
      };
    }
  }
  return results;
}
