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
export interface GetBenchItem<Meta extends {} = {}> {
  (info: string, meta: Meta): Promise<{
    fn: () => Promise<any>;
    close: () => Promise<any>;
  }>;
}

export async function runUserBench<Meta extends {} = {}>(
  config: UserBenchConfig,
  options: {
    series: string[];
    meta: Meta;
    getBenchItem: GetBenchItem<Meta>;
  },
) {
  let gc: (() => void) | undefined;
  if (config.gc) {
    if (!globalThis.gc) {
      throw new Error("Garbage collection is not available. Run with --expose-gc.");
    }
    gc = globalThis.gc;
  } else if (typeof config.gc === "undefined") {
    gc = globalThis.gc;
  }
  const { series, meta, getBenchItem } = options;
  const benchDataDir = config.benchDataDir ?? "./.bench-data";
  const bench = new ConcurrencyBench({
    concurrency: config.concurrency,
    warmupDuration: config.warmupDuration,
    duration: config.duration,
    name: config.benchName,
  });
  const collector = new BenchCollector(benchDataDir);
  for (const benchItemName of series) {
    await using sampleCollector = await collector.openSampleCollector(benchItemName);

    console.log("\n");
    if (gc) {
      console.log("gc");
      gc();
    }
    const { close, fn } = await getBenchItem(benchItemName, meta);
    console.log("running benchmark for", `${benchItemName}`);
    const result = await bench.runWidthCpuAndMemory({
      fn,
      intervalSampleCPUAndMemory: config.intervalSample,
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
      collector.saveBenchResult(benchItemName, result),
    ]);
  }
}
