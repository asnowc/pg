import os from "node:os";
import process from "node:process";
import type {
  ConcurrencyBenchResultWithCPUAndMemory,
  ConcurrencyBenchSample,
  ConcurrencyBenchSnapshot,
} from "../types/bench_result.ts";
import { openFileCollector, readFileSamples, writeFileSamples } from "./SampleCollector.ts";
import fs from "node:fs/promises";

/** 结果目录中的清单文件名，目录结构见 {@link SampleCollector}。 */
export const MANIFEST_FILE_NAME = "manifest.json";
export function createSnapshot(): ConcurrencyBenchSnapshot {
  return {
    user: [],
    system: [],
    rss: [],
    heapTotal: [],
    heapUsed: [],
    external: [],
    arrayBuffers: [],
    currentConcurrency: [],
    nextOperationIndex: [],
    successCount: [],
    errorCount: [],
    timestamp: [],
  };
}
/** 读写单个基准测试结果目录，目录结构见 {@link SampleCollector}。 */
export class BenchCollector {
  static replaceName(name: string) {
    return name.replace(/[\s\/\\:]/g, "_");
  }
  constructor(private dir: string) {
  }
  async ensureDirsExist() {
    await fs.mkdir(this.dir);
  }
  private getResultFilePath(name: string) {
    return `${this.dir}/${BenchCollector.replaceName(name)}.result.json`;
  }
  private getSampleFilePath(name: string) {
    return `${this.dir}/${BenchCollector.replaceName(name)}.sample.bin`;
  }
  private get manifestPath() {
    return `${this.dir}/${MANIFEST_FILE_NAME}`;
  }
  openSampleCollector(name: string) {
    return openFileCollector(this.getSampleFilePath(name));
  }
  saveSampleFile(name: string, samples: ConcurrencyBenchSample[]) {
    return writeFileSamples(this.getSampleFilePath(name), samples);
  }
  readSampleFile(name: string): Promise<ConcurrencyBenchSample[]> {
    return readFileSamples(this.getSampleFilePath(name));
  }

  async saveBenchResult(
    name: string,
    data: ConcurrencyBenchResultWithCPUAndMemory,
    metadata: Record<string, unknown> = {},
  ) {
    const filePath = this.getResultFilePath(name);
    const record: StoredBenchResult = { schemaVersion: 1, metadata, result: data };
    await fs.writeFile(filePath, JSON.stringify(record));
  }
  async getBenchResult(name: string): Promise<StoredBenchResult> {
    const data = await fs.readFile(this.getResultFilePath(name), { encoding: "utf8" });
    return JSON.parse(data) as StoredBenchResult;
  }

  /** 读取清单；目录中没有清单时返回 undefined。 */
  async readManifest(): Promise<BenchManifest | undefined> {
    let text: string;
    try {
      text = await fs.readFile(this.manifestPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    return JSON.parse(text) as BenchManifest;
  }

  /**
   * 目录已有清单且测试名称、参数或 meta 不同时抛出，避免同一目录混入不可比较的结果。
   * 应在运行任何系列前调用。
   */
  async assertManifestCompatible(info: BenchManifestInfo): Promise<void> {
    const existing = await this.readManifest();
    if (existing && manifestKey(existing) !== manifestKey(info)) {
      throw new Error(`${this.manifestPath} was created with different benchmark parameters`);
    }
  }

  /**
   * 在所有系列运行结束后一次性写入清单，记录测试参数、当前运行环境和本次成功的系列。
   * 目录已有清单时保留其中的系列与创建时间，同名系列被本次结果替换。
   */
  async saveManifest(info: BenchManifestInfo, series: string[]): Promise<void> {
    await this.assertManifestCompatible(info);
    const existing = await this.readManifest();
    const existingNames = (existing?.series ?? []).filter((name) => !series.includes(name));
    const manifest: BenchManifest = {
      schemaVersion: 1,
      benchName: info.benchName,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      params: info.params,
      meta: info.meta,
      environment: getRuntimeEnvironment(),
      series: [...existingNames, ...series],
    };
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(this.manifestPath, JSON.stringify(manifest, null, 2));
  }
}
function manifestKey(info: BenchManifestInfo) {
  return JSON.stringify({ benchName: info.benchName, params: info.params, meta: info.meta });
}
export type StoredBenchResult = {
  schemaVersion: 1;
  metadata: Record<string, unknown>;
  result: ConcurrencyBenchResultWithCPUAndMemory;
};

/** 清单中决定结果可比性的部分。 */
export type BenchManifestInfo = { benchName: string; params: BenchManifestParams; meta?: unknown };

/** 影响结果可比性的测试参数，时长单位均为毫秒。 */
export type BenchManifestParams = {
  concurrency: number | number[];
  duration: number;
  warmupDuration?: number;
  intervalSample: number;
  /** 同进程运行的系列是否在测量前手动执行了 gc；命令行在独立子进程中运行时为 false */
  gc?: boolean;
};
export type BenchRuntimeEnvironment = {
  runtime: "deno" | "node";
  /** 运行时版本，例如 Deno 2.x 或 Node v24.x */
  runtimeVersion: string;
  v8: string;
  platform: string;
  arch: string;
  osRelease: string;
  cpuModel: string;
  cpuCount: number;
  /** 总内存，字节 */
  totalMemory: number;
};
export type BenchManifest = {
  schemaVersion: 1;
  benchName: string;
  createdAt: string;
  params: BenchManifestParams;
  meta?: unknown;
  /** 最近一次写入清单的进程所在环境 */
  environment: BenchRuntimeEnvironment;
  /** 已成功生成结果的系列名，按完成顺序排列；各系列的样本与结果见 `<series>.sample.bin` 与 `<series>.result.json` */
  series: string[];
};

function getRuntimeEnvironment(): BenchRuntimeEnvironment {
  const deno = (globalThis as { Deno?: { version: { deno: string; v8: string } } }).Deno;
  const cpus = os.cpus();
  return {
    runtime: deno ? "deno" : "node",
    runtimeVersion: deno ? deno.version.deno : process.version,
    v8: deno ? deno.version.v8 : process.versions.v8,
    platform: os.platform(),
    arch: os.arch(),
    osRelease: os.release(),
    cpuModel: cpus[0]?.model.replace(/\0/g, "").trim() || "unknown",
    cpuCount: cpus.length,
    totalMemory: os.totalmem(),
  };
}
