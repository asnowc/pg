import type { ProgressEvent } from "../ConcurrencyBench.ts";
import type { ConcurrencyBenchResultWithCPUAndMemory } from "../types/bench_result.ts";

export type SeriesSummary = {
  name: string;
  success: number;
  failed: number;
  /** 正式测量时长（不含预热和排空），毫秒 */
  duration: number;
  /** 每秒成功操作数 */
  ops: number;
  /** 失败原因；存在时表示该系列未完成 */
  error?: string;
};

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export function formatCount(value: number): string {
  return numberFormat.format(value);
}
export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m${((ms % 60_000) / 1000).toFixed(1)}s`;
}
function errorMessage(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export type BenchLogger = {
  /** 普通日志，自动带缩进。 */
  info(message: string): void;
  warn(message: string): void;
  /** 可直接作为 `ConcurrencyBench.runWidthCpuAndMemory` 的 onProgress。 */
  progress(event: ProgressEvent): void;
  /** 在 runWidthCpuAndMemory 兑现后输出排空信息。 */
  drain(result: ConcurrencyBenchResultWithCPUAndMemory): void;
};

/** 创建基准测试日志器，所有输出带统一缩进，便于在多系列输出中区分层级。 */
export function createBenchLogger(indent = "  "): BenchLogger {
  const info = (message: string) => console.log(indent + message);
  const warn = (message: string) => console.warn(indent + message);
  return {
    info,
    warn,
    progress(event) {
      switch (event.type) {
        case "warmup-end": {
          const { concurrency, duration, iterations } = event.data;
          info(
            `warmup    c=${pad(concurrency, 6)} ${pad(formatMs(duration), 8)}` +
              ` ${formatCount(iterations)} operations started`,
          );
          break;
        }
        case "stage-end": {
          const { index, total, concurrency, duration, success, failed } = event.data;
          const ops = duration > 0 ? (success * 1000) / duration : 0;
          info(
            `stage ${index + 1}/${total}` +
              ` c=${pad(concurrency, 6)} ${pad(formatMs(duration), 8)}` +
              ` ok ${pad(formatCount(success), 10)} ops/s ${formatCount(ops)}` +
              (failed ? `  fail ${formatCount(failed)}` : ""),
          );
          break;
        }
        case "first-error":
          warn(`first failed operation: ${errorMessage(event.data.error)}`);
          break;
      }
    },
    drain(result) {
      // runBench 在停止补发后立即补采一次快照，其中的在途数即需要排空的操作数
      const inFlight = result.snapshot.find((s) => s.timestamp >= result.endTime)?.currentConcurrency;
      const count = inFlight === undefined ? "" : `${formatCount(inFlight)} in-flight operations `;
      info(`drain     ${count}settled in ${formatMs(result.clearTime - result.endTime)}`);
    },
  };
}
function pad(value: string | number, width: number) {
  return String(value).padEnd(width);
}

export function printBenchHeader(input: {
  benchName: string;
  series: string[];
  concurrency: number | number[];
  duration: number;
  warmupDuration?: number;
  intervalSample: number;
  meta?: unknown;
}) {
  const concurrency = typeof input.concurrency === "number" ? [input.concurrency] : input.concurrency;
  console.log(`\nBenchmark: ${input.benchName}`);
  console.log(`  series       ${input.series.join(", ")}`);
  console.log(`  concurrency  ${concurrency.join(", ")} (${formatMs(input.duration)} each)`);
  console.log(`  warmup       ${formatMs(input.warmupDuration ?? 0)}`);
  console.log(`  sampling     every ${formatMs(input.intervalSample)}`);
  if (input.meta !== undefined) console.log(`  meta         ${JSON.stringify(input.meta)}`);
}

export function printSeriesTitle(index: number, total: number, name: string) {
  console.log(`\n[${index + 1}/${total}] ${name}`);
}

export function printSummary(rows: SeriesSummary[], elapsed: number) {
  const header = ["series", "ok", "fail", "avg ops/s", "status"];
  const body = rows.map((row) => [
    row.name,
    formatCount(row.success),
    formatCount(row.failed),
    formatCount(row.ops),
    row.error ? `FAILED: ${row.error}` : "ok",
  ]);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((r) => (i === 4 ? 0 : r[i].length))));
  const line = (cells: string[]) =>
    "  " +
    cells.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : i === 4 ? cell : cell.padStart(widths[i]))).join("  ");

  console.log(`\nSummary (${formatMs(elapsed)})`);
  console.log(line(header));
  for (const row of body) console.log(line(row));
}
