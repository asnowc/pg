import { BenchCollector, ConcurrencyBench, GetBenchItem, UserBenchConfig } from "../bench.ts";

/*
  该文件用于在进程内运行基准测试项，并收集基准测试结果。
  */
async function getBenchConfig() {
  const jsFile = process.argv[2];
  const config = JSON.parse(process.argv[3]) as {
    config: Partial<UserBenchConfig>;
    meta: Record<string, any>;
  };
  const { getBench, BENCH_CONFIG, META } = await loadBenchmarkFileConfig(jsFile);

  return {
    getBench,
    config: {
      ...BENCH_CONFIG,
      ...config.config,
    },
    meta: { ...META, ...config.meta },
  };
}

export async function startRunBenchItem(itemName: string) {
  const { config, getBench, meta } = await getBenchConfig();
  const bench = new ConcurrencyBench({
    concurrency: config.concurrency,
    warmupDuration: config.warmupDuration,
    duration: config.duration,
    name: config.benchName,
  });
  const benchDataDir = config.benchDataDir ?? "./.bench-data";

  const { close, fn } = await getBench(itemName, meta);
  const collector = new BenchCollector(benchDataDir);
  await using sampleCollector = await collector.openSampleCollector(itemName);

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
    collector.saveBenchResult(itemName, result),
  ]);
}
async function loadBenchmarkFileConfig(jsFile: string) {
  const { default: getBench, BENCH_CONFIG, SERIES, META } = await import(jsFile) as BenchModule<any>;
  if (typeof getBench !== "function") {
    throw new Error("Default export is not a function");
  }
  if (typeof BENCH_CONFIG !== "object") {
    throw new Error("BENCH_CONFIG is not exported");
  }
  if (!Array.isArray(SERIES)) {
    throw new Error("SERIES is not exported or not an array");
  }
  return { getBench, BENCH_CONFIG, SERIES, META };
}
interface BenchModule<Meta extends {} = {}> {
  default: GetBenchItem<Meta>;
  BENCH_CONFIG: UserBenchConfig;
  SERIES: string[];
  META?: Meta;
}
