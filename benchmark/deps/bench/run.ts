import path from "node:path";
import { BenchCollector, type BenchManifestParams } from "./collector/BenchCollector.ts";
import { ConcurrencyBench } from "./ConcurrencyBench.ts";
import type { ConcurrencyBenchResult, ConcurrencyBenchResultWithCPUAndMemory } from "./types/bench_result.ts";
import {
  createBenchLogger,
  formatCount,
  formatMs,
  printBenchHeader,
  printSeriesTitle,
  printSummary,
  type SeriesSummary,
} from "./utils/logger.ts";
import { genResultSvgFromResultDir, type SvgReportOptions } from "../bench.ts";

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
  /** 运行结束后生成 SVG 报告时使用的显示选项，例如 `{ preset: "compact" }`。 */
  report?: SvgReportOptions;
}
export interface GetBenchItem<Meta extends {} = {}> {
  (info: string, meta: Meta): Promise<{
    fn: () => Promise<any>;
    close: () => Promise<any>;
  }>;
}

function summarizeResult(name: string, result: ConcurrencyBenchResult): SeriesSummary {
  const duration = result.endTime - result.startTime;
  return {
    name,
    success: result.totalSuccessSamples,
    failed: result.totalFailedSamples,
    duration,
    ops: duration > 0 ? (result.totalSuccessSamples * 1000) / duration : 0,
  };
}

function createConcurrencyBench(config: UserBenchConfig): ConcurrencyBench {
  return new ConcurrencyBench({
    concurrency: config.concurrency,
    warmupDuration: config.warmupDuration,
    duration: config.duration,
    name: config.benchName,
  });
}

/** 按 config.gc 解析 gc 函数；显式要求 gc 但不可用时抛出。 */
function resolveGc(config: Pick<UserBenchConfig, "gc">): (() => void) | undefined {
  if (config.gc) {
    if (!globalThis.gc) {
      throw new Error("Garbage collection is not available. Run with --expose-gc (Deno: --v8-flags=--expose-gc).");
    }
    return globalThis.gc;
  }
  if (typeof config.gc === "undefined") return globalThis.gc;
  return undefined;
}
function resolveDataDir(config: UserBenchConfig) {
  return path.resolve(config.benchDataDir ?? "./.bench-data");
}
function manifestParams(config: UserBenchConfig): BenchManifestParams {
  const { concurrency, duration, warmupDuration, intervalSample, gc } = config;
  return { concurrency, duration, warmupDuration, intervalSample, gc };
}

/**
 * 在当前进程内运行单个系列：初始化 -> 测量 -> 释放 -> 保存样本与结果，并输出系列内部日志，
 * 样本与结果保存到 config.benchDataDir。不输出标题和汇总，这些由 {@link runBenchSuite} 负责。
 * 初始化成功后才创建样本文件，避免失败时残留空样本文件导致重跑冲突。
 */
export async function runBenchItem<Meta extends {} = {}>(
  config: UserBenchConfig,
  options: { series: string; meta: Meta; getBenchItem: GetBenchItem<Meta> },
): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
  const { series: name, meta, getBenchItem } = options;
  const bench = createConcurrencyBench(config);
  const collector = new BenchCollector(resolveDataDir(config));
  const logger = createBenchLogger();

  const setupStart = performance.now();
  const { close, fn } = await getBenchItem(name, meta);
  logger.info(`setup     ${formatMs(performance.now() - setupStart)}`);

  let result: ConcurrencyBenchResultWithCPUAndMemory;
  try {
    await using sampleCollector = await collector.openSampleCollector(name);
    result = await bench.runWidthCpuAndMemory({
      fn,
      intervalSampleCPUAndMemory: config.intervalSample,
      collectorSuccess: sampleCollector,
      collectorFailed: { push: () => {} },
      onProgress: logger.progress,
    });
    logger.drain(result);
  } finally {
    const closeStart = performance.now();
    await close();
    logger.info(`teardown  ${formatMs(performance.now() - closeStart)}`);
  }
  await collector.saveBenchResult(name, result);

  const summary = summarizeResult(name, result);
  const failed = summary.failed ? `, ${formatCount(summary.failed)} failed` : "";
  logger.info(
    `result    ${formatCount(summary.success)} ok${failed}, avg ${formatCount(summary.ops)} ops/s` +
      ` over ${formatMs(summary.duration)}`,
  );
  return result;
}

/**
 * 依次运行所有系列并输出配置头、系列标题、耗时与汇总表。系列的具体执行方式由 runItem 决定
 * （同进程或子进程），runItem 需把样本与结果保存到 config.benchDataDir 并返回运行结果。
 * 开始前检查结果目录已有清单的参数是否一致，所有系列结束后一次性写入清单，只登记成功的系列。
 * 单个系列失败只记录到汇总表，不会中断其余系列，也不会使返回的 Promise 拒绝。
 */
export async function runBenchSuite(
  config: UserBenchConfig,
  options: {
    series: string[];
    meta?: unknown;
    runItem: (series: string) => Promise<ConcurrencyBenchResultWithCPUAndMemory>;
  },
): Promise<void> {
  const { series, meta, runItem } = options;
  const outputDir = resolveDataDir(config);
  const collector = new BenchCollector(outputDir);
  const manifestInfo = { benchName: config.benchName, params: manifestParams(config), meta };
  await collector.assertManifestCompatible(manifestInfo);

  printBenchHeader({ ...config, series, meta });
  const startTime = performance.now();
  const summaries: SeriesSummary[] = [];
  for (const [index, name] of series.entries()) {
    printSeriesTitle(index, series.length, name);
    const logger = createBenchLogger();
    const itemStart = performance.now();
    try {
      const result = await runItem(name);
      summaries.push(summarizeResult(name, result));
      logger.info(`done in ${formatMs(performance.now() - itemStart)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`failed    ${message}`);
      summaries.push({ name, success: 0, failed: 0, duration: 0, ops: 0, error: message });
    }
  }
  printSummary(summaries, performance.now() - startTime);
  await collector.saveManifest(manifestInfo, series);
}

/** 在当前进程内依次运行所有系列，结束后输出汇总表。单个系列失败不会中断其余系列。 */
export async function runUserBench<Meta extends {} = {}>(
  config: UserBenchConfig,
  options: {
    series: string[];
    meta: Meta;
    getBenchItem: GetBenchItem<Meta>;
  },
): Promise<void> {
  const gc = resolveGc(config);
  const { series, meta, getBenchItem } = options;
  const outputDir = resolveDataDir(config);

  await runBenchSuite(config, {
    series,
    meta,
    runItem: (name) => {
      if (gc) {
        const start = performance.now();
        gc();
        createBenchLogger().info(`gc        ${formatMs(performance.now() - start)}`);
      }
      return runBenchItem(config, { series: name, meta, getBenchItem });
    },
  });
  try {
    const svg = await genResultSvgFromResultDir(outputDir, { report: config.report });
    console.log(`\nSVG report generated: ${svg}`);
  } catch (error) {
    console.log(`\nResults saved to ${outputDir}`);
    throw error;
  }
}
