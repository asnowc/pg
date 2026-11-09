import type { AnalyzedSampleGroup, IntervalMetric } from "../../analyzer/sample_group.ts";
import type { BenchManifest } from "../../collector/BenchCollector.ts";

/**
 * 报告区块，始终按此顺序渲染，选项只决定是否出现：
 * - `environment`：运行环境、测试参数与 meta
 * - `summary`：整个正式测量窗口的汇总排行（操作数、错误率、ops/s、延迟）
 * - `throughput`：各并发档 ops/s 分组柱状图及在途数/吞吐曲线
 * - `latency`：各并发档的延迟明细表
 * - `distribution`：各并发档紧凑纵向排列的水平延迟增量堆叠条，横轴从该档所有系列的最小请求延迟开始
 * - `resource`：资源摘要、每请求 CPU 与平均 RSS 柱状图
 * - `cpu`：User/System/Total CPU 时间与使用率四张阶梯图，以及每档每请求 CPU 堆叠柱状图
 * - `memory`：`metrics` 指定的内存时间曲线
 * - `notes`：附注与口径说明
 */
const SVG_SECTIONS = [
  "environment",
  "summary",
  "throughput",
  "latency",
  "distribution",
  "resource",
  "cpu",
  "memory",
  "notes",
] as const;
export type SvgSection = typeof SVG_SECTIONS[number];

const INTERVAL_METRICS: readonly IntervalMetric[] = [
  "inFlight",
  "ops",
  "cpu",
  "rss",
  "memoryExtended",
  "arrayBuffers",
  "jsHeap",
];

const LATENCY_FIELDS = ["min", "p50", "p75", "p90", "p95", "p99", "p995", "p999", "max", "mean", "rme"] as const;
/** 延迟统计字段，`rme` 为 95% 均值置信区间的相对半宽（%）。 */
export type LatencyField = typeof LATENCY_FIELDS[number];

export const SVG_PRESETS = ["default", "compact", "throughput", "latency", "resource"] as const;
export type SvgPreset = typeof SVG_PRESETS[number];

/** 报告中的术语，使报告能贴合被测对象，例如 `{ series: "Library", operations: "queries", throughput: "QPS" }`。 */
export type SvgLabels = {
  /** 被比较对象的列名，默认 `Series`。 */
  series: string;
  /** 单次被测调用的单数名称，默认 `operation`。 */
  operation: string;
  /** 被测调用的复数或缩写名称，默认 `ops`。 */
  operations: string;
  /** 吞吐单位，默认 `ops/s`。 */
  throughput: string;
};

const DEFAULT_LABELS: SvgLabels = { series: "Series", operation: "operation", operations: "ops", throughput: "ops/s" };

/** 控制 SVG 中显示的区块与信息。未指定的字段取自 `preset`（默认 `"default"`，即渲染全部内容）。 */
export type SvgReportOptions = {
  preset?: SvgPreset;
  /** 覆盖报告中的术语，未指定的字段使用默认值，不受预设影响。 */
  labels?: Partial<SvgLabels>;
  /** 显示的区块，渲染顺序固定为 {@link SVG_SECTIONS} 的顺序。 */
  sections?: readonly SvgSection[];
  /** 可选曲线：inFlight/ops 属于 throughput，cpu 属于 cpu，其余属于 memory，按给定顺序渲染。 */
  metrics?: readonly IntervalMetric[];
  /**
   * 是否在吞吐柱状图和内存曲线下方显示各并发档的平均值排行，不影响 CPU 柱状图。
   * 所有排行统一按数值从高到低排序，倍数为相对同表最低值的比值。
   */
  rankings?: boolean;
  /** `latency` 区块显示的统计列。 */
  latencyColumns?: readonly LatencyField[];
  /** `latency` 区块的排序与倍数依据，默认 `mean`。 */
  latencySortBy?: LatencyField;
  /** `distribution` 区块的统计点，按值升序构造增量堆叠，柱顶为最高选定值；不能包含 `rme`。 */
  distribution?: readonly LatencyField[];
};
type PresetOptions = {
  readonly [K in Exclude<keyof SvgReportOptions, "preset" | "labels">]-?: NonNullable<SvgReportOptions[K]>;
};
export type ResolvedSvgReportOptions = PresetOptions & { readonly labels: SvgLabels };

const ALL_PERCENTILES: readonly LatencyField[] = ["p50", "p75", "p90", "p95", "p99", "p995", "p999"];
const DEFAULT_LATENCY_COLUMNS: readonly LatencyField[] = ["p50", "p90", "p99", "p999", "max", "mean", "rme"];

/** 常用预设。 */
const svgReportPresets: Readonly<Record<SvgPreset, PresetOptions>> = {
  /** 全部区块、全部资源曲线与全部延迟列 */
  default: {
    sections: SVG_SECTIONS,
    metrics: INTERVAL_METRICS,
    rankings: true,
    latencyColumns: LATENCY_FIELDS,
    latencySortBy: "mean",
    distribution: [...ALL_PERCENTILES, "max"],
  },
  /** 适合 README 或 PR 的一屏概览：汇总、吞吐和延迟分布 */
  compact: {
    sections: ["environment", "summary", "throughput", "distribution"],
    metrics: [],
    rankings: false,
    latencyColumns: ["p50", "p99", "mean"],
    latencySortBy: "mean",
    distribution: ["p50", "p90", "p99", "p999"],
  },
  /** 吞吐：汇总、吞吐柱状图与并发/吞吐曲线 */
  throughput: {
    sections: ["environment", "summary", "throughput", "notes"],
    metrics: ["inFlight", "ops"],
    rankings: true,
    latencyColumns: DEFAULT_LATENCY_COLUMNS,
    latencySortBy: "mean",
    distribution: ALL_PERCENTILES,
  },
  /** 延迟：汇总、百分位分布与完整延迟明细 */
  latency: {
    sections: ["environment", "summary", "distribution", "latency", "notes"],
    metrics: [],
    rankings: false,
    latencyColumns: LATENCY_FIELDS,
    latencySortBy: "p99",
    distribution: [...ALL_PERCENTILES, "max"],
  },
  /** 资源：摘要、CPU/RSS 柱状图、CPU 阶梯图、各档 CPU 堆叠柱状图与内存曲线 */
  resource: {
    sections: ["environment", "resource", "cpu", "memory", "notes"],
    metrics: ["cpu", "rss", "memoryExtended", "arrayBuffers", "jsHeap"],
    rankings: true,
    latencyColumns: DEFAULT_LATENCY_COLUMNS,
    latencySortBy: "mean",
    distribution: ALL_PERCENTILES,
  },
};

function assertKnown<T extends string>(kind: string, values: readonly string[], allowed: readonly T[]) {
  for (const value of values) {
    if (!allowed.includes(value as T)) {
      throw new Error(`Unknown ${kind} "${value}". Expected one of: ${allowed.join(", ")}`);
    }
  }
}

/**
 * 以预设为基础合并显式选项。
 * @throws 预设、区块、指标或延迟字段名称无效时抛出，便于命令行直接报告错误。
 */
export function resolveSvgReportOptions(options: SvgReportOptions = {}): ResolvedSvgReportOptions {
  const preset = options.preset ?? "default";
  assertKnown("preset", [preset], SVG_PRESETS);
  const base = svgReportPresets[preset];
  const resolved: ResolvedSvgReportOptions = {
    labels: { ...DEFAULT_LABELS, ...options.labels },
    sections: options.sections ?? base.sections,
    metrics: options.metrics ?? base.metrics,
    rankings: options.rankings ?? base.rankings,
    latencyColumns: options.latencyColumns ?? base.latencyColumns,
    latencySortBy: options.latencySortBy ?? base.latencySortBy,
    distribution: options.distribution ?? base.distribution,
  };
  assertKnown("section", resolved.sections, SVG_SECTIONS);
  assertKnown("metric", resolved.metrics, INTERVAL_METRICS);
  assertKnown("latency column", resolved.latencyColumns, LATENCY_FIELDS);
  assertKnown("latency sort field", [resolved.latencySortBy], LATENCY_FIELDS);
  assertKnown("distribution point", resolved.distribution, LATENCY_FIELDS.filter((field) => field !== "rme"));
  assertKnown("label", Object.keys(resolved.labels), Object.keys(DEFAULT_LABELS) as (keyof SvgLabels)[]);
  for (const [key, value] of Object.entries(resolved.labels)) {
    if (typeof value !== "string") throw new Error(`Label "${key}" must be a string`);
  }
  return resolved;
}

export type SvgReportInput = SvgReportOptions & {
  path: string;
  results: AnalyzedSampleGroup[];
  title?: string;
  /** 结果目录清单，提供 `environment` 区块的运行环境与测试参数。 */
  manifest?: Pick<BenchManifest, "createdAt" | "params" | "meta" | "environment">;
  notes?: string[];
};

export const LATENCY_LABELS: Record<LatencyField, string> = {
  min: "min",
  p50: "p50",
  p75: "p75",
  p90: "p90",
  p95: "p95",
  p99: "p99",
  p995: "p99.5",
  p999: "p99.9",
  max: "max",
  mean: "mean",
  rme: "RME %",
};
