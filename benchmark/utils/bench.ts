import { Bench } from "tinybench";

/**
 * 获取排序后的基准测试结果。排序顺序为，最快 -> 最慢 -> 无结果。无论是否翻转，无结果始终排在最后。
 * @param reverse 是否反转排序顺序，翻转后，ratio 相对于最慢基准测试的比率
 */
export function getSortedResult(bench: Bench, reverse?: boolean): unknown[] {
  const completeResults = bench.results.filter((result) => result.state === "completed");
  const unknownResults = bench.results.filter((result) => result.state !== "completed");
  const results = completeResults.map((result, index): BenchResult => {
    const task = bench.tasks[index];
    return {
      name: task.name,
      hz: result.throughput.mean,
      mean: result.latency.mean,
      min: result.latency.min,
      max: result.latency.max,
      p75: result.latency.p75,
      p99: result.latency.p99,
      p995: result.latency.p995,
      p999: result.latency.p999,
      rme: result.latency.rme,
      samples: result.latency.samplesCount,
      ratio: 0,
    };
  }).sort((left, right) => {
    return reverse ? left.hz - right.hz : right.hz - left.hz;
  });
  const results2 = unknownResults.map((result, index): Partial<BenchResult> => {
    const task = bench.tasks[index];
    return { name: task.name };
  });

  const baseline = reverse ? results[0].hz : results[results.length - 1].hz;
  for (const result of results) {
    result.ratio = result.hz / baseline;
  }
  return [
    ...results.map(({ ratio, name, ...result }) => {
      return {
        name,
        ratio: ratio.toFixed(2) + "X",
        hz: floor(result.hz, 5),
        "mean (ms)": result.mean.toFixed(5) + " ±" + result.rme.toFixed(2) + "%",
        "min (ms)": floor(result.min, 5),
        "max (ms)": floor(result.max, 5),
        p75: (result.p75 * 100).toFixed(2) + "%",
        p99: (result.p99 * 100).toFixed(2) + "%",
        p995: (result.p995 * 100).toFixed(2) + "%",
        p999: (result.p999 * 100).toFixed(2) + "%",
      };
    }),
    ...results2,
  ];
}
type BenchResult = {
  name: string;
  hz: number;
  min: number;
  max: number;
  mean: number;
  p75: number;
  p99: number;
  p995: number;
  p999: number;
  rme: number;
  samples: number;
  /** 相对于最快基准测试的比率 */
  ratio: number;
};
function floor(value: number, x: number) {
  const c = 10 ** x;
  return Math.floor(value * c) / c;
}
