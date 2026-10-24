import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import {
  BenchCollector,
  genResultSvgFromResultDir,
  GetBenchItem,
  resolveSvgReportOptions,
  runBenchSuite,
  type UserBenchConfig,
} from "../bench.ts";
import { CHILD_TASK_ENV, ChildTask } from "./child_task.ts";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type SvgReportCliOptions, toSvgReportOptions } from "./report_options.ts";

export type RunOptions = SvgReportCliOptions & {
  series?: string[];
  out?: string;
  concurrency?: number[];
  duration?: number;
  warmup?: number;
  interval?: number;
  meta?: Record<string, unknown>;
  report: boolean;
};

/** 每个系列在独立子进程中运行。返回报告是否生成成功（未要求报告时为 true）。 */
export async function runCommand(file: string, options: RunOptions): Promise<boolean> {
  console.log(`Running benchmark series in child process`);
  const plan = await resolveRunPlan(file, options);
  const { fileUrl, config, series, meta, outputDir } = plan;
  // 在运行前校验报告选项，避免跑完全部系列后才因选项错误失败
  if (options.report) resolveSvgReportOptions(config.report);
  await prepareOutputDir(outputDir, series);

  const collector = new BenchCollector(outputDir);
  await runBenchSuite(config, {
    series,
    meta,
    gc: "isolated",
    runItem: async (name) => {
      await spawnBenchItem({ file: fileUrl, series: name, config, meta });
      return (await collector.getBenchResult(name)).result;
    },
  });

  if (!options.report) {
    console.log(`\nResults: ${outputDir}`);
    return true;
  }
  const svgPath = await genResultSvgFromResultDir(outputDir, { report: config.report });
  console.log(`\nReport: ${svgPath}`);
  return true;
}

/** 合并模块导出与命令行参数，得到最终的运行配置。 */
async function resolveRunPlan(file: string, options: RunOptions) {
  const fileUrl = pathToFileURL(path.resolve(file)).href;
  const mod = await loadBenchModule(fileUrl);
  const series = options.series ?? mod.SERIES;
  if (!series.length) throw new Error("No series to run");

  const base = mod.BENCH_CONFIG;
  // 必须由主进程统一确定目录：模块内按时间戳生成的目录在每个子进程中都不同
  const outputDir = path.resolve(options.out ?? base.benchDataDir ?? "./.bench-data");
  const config: UserBenchConfig = {
    ...base,
    concurrency: options.concurrency ?? base.concurrency,
    duration: options.duration ?? base.duration,
    warmupDuration: options.warmup ?? base.warmupDuration,
    intervalSample: options.interval ?? base.intervalSample,
    benchDataDir: outputDir,
    report: { ...base.report, ...toSvgReportOptions(options) },
  };
  const meta: Record<string, unknown> = { ...mod.META, ...options.meta };
  return { fileUrl, config, series, meta, outputDir };
}

/** 样本文件以独占方式创建，提前检查冲突，避免跑完前面的系列后才失败。 */
async function prepareOutputDir(outputDir: string, series: string[]) {
  const existingFiles = new Set(await fs.readdir(outputDir).catch(() => []));
  const conflicts = series.filter((name) => {
    const fileName = BenchCollector.replaceName(name);
    return existingFiles.has(`${fileName}.sample.bin`) || existingFiles.has(`${fileName}.result.json`);
  });
  if (conflicts.length) {
    throw new Error(`Results already exist in ${outputDir} for: ${conflicts.join(", ")}. Use another --out directory.`);
  }
  await fs.mkdir(outputDir, { recursive: true });
}

/** 基准测试文件需要导出的成员。 */
interface BenchModule<Meta extends {} = {}> {
  default: GetBenchItem<Meta>;
  BENCH_CONFIG: UserBenchConfig;
  SERIES: string[];
  META?: Meta;
}

async function loadBenchModule(fileUrl: string): Promise<BenchModule<any>> {
  const mod = await import(fileUrl) as Partial<BenchModule<any>>;
  if (typeof mod.default !== "function") {
    throw new Error(`${fileUrl}: default export must be a GetBenchItem function`);
  }
  if (typeof mod.BENCH_CONFIG !== "object" || mod.BENCH_CONFIG === null) {
    throw new Error(`${fileUrl}: BENCH_CONFIG is not exported`);
  }
  if (!Array.isArray(mod.SERIES)) {
    throw new Error(`${fileUrl}: SERIES is not exported or not an array`);
  }
  return mod as BenchModule<any>;
}
const CHILD_ENTRY = fileURLToPath(new URL("./run_in_process.ts", import.meta.url));
const isDeno = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";

/**
 * 启动 run_in_process.ts 子进程执行单个系列；子进程输出直接继承到当前终端。
 * 每个系列都在新进程中运行，不需要手动 gc。
 */
export function spawnBenchItem(task: ChildTask): Promise<void> {
  const args = isDeno ? ["run", "-A", CHILD_ENTRY] : [...process.execArgv, CHILD_ENTRY];
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: "inherit",
      env: { ...process.env, [CHILD_TASK_ENV]: JSON.stringify(task) },
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `child process killed by ${signal}` : `child process exited with code ${code}`));
    });
  });
}
