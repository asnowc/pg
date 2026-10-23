import { BenchCollector } from "../bench.ts";
import { ConcurrencyBench } from "./ConcurrencyBench.ts";

export interface UserBenchConfig {
  benchName: string;
  /**
   * 每组并发的持续时间，单位毫秒。
   */
  duration: number;
  concurrency: number | number[];
  /** 预热时长，单位毫秒 */
  warmupDuration?: number;
  /** 采样间隔，单位毫秒 */
  intervalSample: number;
  benchDataDir?: string;

  /**
   * 是否在每次基准运行前进行垃圾回收。
   */
  gc?: boolean;
}
export interface GetBenchItem<Meta extends {}, T extends { name: string }> {
  (target: T, meta: Meta): Promise<{
    fn: () => Promise<unknown>;
    close: () => Promise<unknown>;
  }>;
}
export async function runUserBench<Meta extends {}, T extends { name: string }>(
  options: UserBenchConfig & {
    series: T[];
    meta: Meta;
    getBenchItem: GetBenchItem<Meta, T>;
  },
) {
  const { series, meta, getBenchItem, benchDataDir = "./.bench-data" } = options;
  const bench = new ConcurrencyBench({
    concurrency: options.concurrency,
    warmupDuration: options.warmupDuration,
    duration: options.duration,
    name: options.benchName,
  });
  const collector = new BenchCollector(benchDataDir);
  for (const target of series) {
    await using sampleCollector = await collector.openSampleCollector(target.name);

    console.log("\n");
    if (globalThis.gc) {
      console.log("gc");
      globalThis.gc?.();
    }
    const { close, fn } = await getBenchItem(target.name, meta);
    console.log("running benchmark for", `${target.name}-${options.benchName}`);
    const result = await bench.runWidthCpuAndMemory({
      fn,
      intervalSampleCPUAndMemory: options.intervalSample,
      collectorSuccess: {
        push: (sample) => {
          sampleCollector.push(sample);
        },
      },
      collectorFailed: {
        push: () => {
          console.log("Failed sample");
        },
      },
    });
    await close();

    await Promise.allSettled([
      collector.saveBenchResult(target.name, result),
    ]);
  }
}
