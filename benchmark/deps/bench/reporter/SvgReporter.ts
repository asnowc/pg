import fs from "node:fs/promises";
import path from "node:path";
import type { BarSeriesOption, EChartsOption, LineSeriesOption } from "echarts";
import {
  type AnalyzedSampleGroup,
  type InstantMetric,
  type IntervalMetric,
  snapshotMetric,
} from "../analyzer/sample_group.ts";
import type { BenchManifest } from "../collector/BenchCollector.ts";

/**
 * 报告区块，始终按此顺序渲染，选项只决定是否出现：
 * - `environment`：运行环境、测试参数与 meta
 * - `summary`：整个正式测量窗口的汇总排行（操作数、错误率、ops/s、延迟、CPU 均值、RSS 峰值）
 * - `throughput`：各并发档 ops/s 分组柱状图
 * - `distribution`：各并发档的延迟百分位分布曲线
 * - `latency`：各并发档的延迟明细表
 * - `timeline`：`metrics` 指定的资源时间曲线
 * - `notes`：附注与口径说明
 */
const SVG_SECTIONS = [
  "environment",
  "summary",
  "throughput",
  "distribution",
  "latency",
  "timeline",
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
  /** `timeline` 区块中绘制的资源曲线，按给定顺序渲染。 */
  metrics?: readonly IntervalMetric[];
  /**
   * 是否在吞吐柱状图和资源曲线下方显示各并发档的平均值排行。
   * 所有排行统一按数值从高到低排序，倍数为相对同表最低值的比值。
   */
  rankings?: boolean;
  /** `latency` 区块显示的统计列。 */
  latencyColumns?: readonly LatencyField[];
  /** `latency` 区块的排序与倍数依据，默认 `mean`。 */
  latencySortBy?: LatencyField;
  /** `distribution` 区块横轴上的百分位点，不能包含 `rme`。 */
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
    sections: ["environment", "summary", "throughput", "timeline", "notes"],
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
  /** 资源：CPU 与各类内存曲线及其排行 */
  resource: {
    sections: ["environment", "timeline", "notes"],
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

type MetricInfo = { title: string; better: "higher" | "lower" | null };

const METRIC_INFO: Record<IntervalMetric, MetricInfo> = {
  inFlight: { title: "In-flight operations (sampled)", better: null },
  ops: { title: "Throughput", better: "higher" },
  cpu: { title: "CPU (% of one logical core)", better: "lower" },
  rss: { title: "Process RSS (MiB)", better: "lower" },
  memoryExtended: { title: "External memory (MiB)", better: "lower" },
  arrayBuffers: { title: "ArrayBuffer memory (MiB)", better: "lower" },
  jsHeap: { title: "JS heap used (MiB)", better: "lower" },
};

const LATENCY_LABELS: Record<LatencyField, string> = {
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

const WIDTH = 1200;
const MARGIN = 40;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;
const CHART_HEIGHT = 220;
const ROW_HEIGHT = 22;
const FONT = "Arial, sans-serif";
const TEXT_COLOR = "#0f172a";
const MUTED_COLOR = "#64748b";
const BETTER_HINT = { higher: "higher is better", lower: "lower is better" };

type Graphic = NonNullable<Extract<EChartsOption["graphic"], unknown[]>>[number];
type XAxis = NonNullable<Extract<EChartsOption["xAxis"], unknown[]>>[number];
type YAxis = NonNullable<Extract<EChartsOption["yAxis"], unknown[]>>[number];
type Rect = { left: number; top: number; width: number; height: number };
type TableColumn = { title: string; width: number; align?: "left" | "right" };
type TableRow = { cells: string[]; color: string };

const format = (value: number | null | undefined, digits = 2) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "N/A"
    : value.toLocaleString("en-US", { maximumFractionDigits: digits });

const seriesColor = (index: number) => `hsl(${(215 + index * 137.508) % 360}, 65%, 40%)`;

type Ranked<T> = { item: T; index: number; value: number | null; ratio: number | null };

/**
 * 按数值从高到低排序（无数据的项排在末尾，同值保持原顺序），
 * 并计算每项相对于最低值的倍数；最低值为 0 时只有同为 0 的项有倍数。
 */
function rankDescending<T>(items: readonly T[], value: (item: T) => number | null): Ranked<T>[] {
  const ranked: Ranked<T>[] = items.map((item, index) => ({ item, index, value: value(item), ratio: null }));
  ranked.sort((a, b) => {
    if (a.value === null || b.value === null) {
      return (a.value === null ? 1 : 0) - (b.value === null ? 1 : 0) || a.index - b.index;
    }
    return b.value - a.value || a.index - b.index;
  });
  const values = ranked.flatMap((row) => row.value === null ? [] : [row.value]);
  const lowest = values.length ? Math.min(...values) : null;
  for (const row of ranked) {
    if (row.value === null || lowest === null) continue;
    row.ratio = lowest === 0 ? (row.value === 0 ? 1 : null) : row.value / lowest;
  }
  return ranked;
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const formatRatio = (ratio: number | null) => ratio === null ? "N/A" : `${ratio.toFixed(2)}x`;

const stageCountOf = (results: AnalyzedSampleGroup[]) => Math.max(0, ...results.map((result) => result.stages.length));
const stageConcurrency = (results: AnalyzedSampleGroup[], index: number) =>
  results.find((result) => result.stages[index])?.stages[index].concurrency;
const errorRate = (success: number, failed: number) => success + failed > 0 ? failed / (success + failed) * 100 : null;

/** 自上而下累积 ECharts 配置，每个区块只需关心自己的高度。 */
class ReportLayout {
  top = 0;
  readonly grids: NonNullable<Extract<EChartsOption["grid"], unknown[]>> = [];
  readonly xAxes: XAxis[] = [];
  readonly yAxes: YAxis[] = [];
  readonly series: (LineSeriesOption | BarSeriesOption)[] = [];
  readonly graphics: Graphic[] = [];

  text(text: string, options: { x?: number; color?: string; font?: string; align?: "left" | "right" } = {}) {
    this.graphics.push({
      type: "text",
      style: {
        text,
        x: options.x ?? MARGIN,
        y: this.top,
        fill: options.color ?? TEXT_COLOR,
        font: options.font ?? `12px ${FONT}`,
        align: options.align ?? "left",
      },
    });
  }

  /** 标题，hint 以灰色右对齐显示在同一行。 */
  heading(text: string, size = 15, hint?: string) {
    this.top += 8;
    this.text(text, { font: `bold ${size}px ${FONT}` });
    if (hint) this.text(hint, { x: WIDTH - MARGIN, align: "right", color: MUTED_COLOR, font: `italic 12px ${FONT}` });
    this.top += size + 12;
  }

  table(columns: TableColumn[], rows: TableRow[], left = MARGIN) {
    const xs: number[] = [];
    let x = left;
    for (const column of columns) {
      xs.push(column.align === "right" ? x + column.width : x);
      x += column.width;
    }
    columns.forEach((column, i) =>
      this.text(column.title, { x: xs[i], align: column.align, font: `bold 12px ${FONT}`, color: MUTED_COLOR })
    );
    this.top += ROW_HEIGHT - 4;
    this.graphics.push({
      type: "line",
      shape: { x1: left, y1: this.top, x2: Math.min(x, WIDTH - MARGIN), y2: this.top },
      style: { stroke: "#cbd5e1", lineWidth: 1 },
    });
    this.top += 4;
    for (const row of rows) {
      row.cells.forEach((cell, i) => this.text(cell, { x: xs[i], align: columns[i].align, color: row.color }));
      this.top += ROW_HEIGHT;
    }
  }

  /** 在给定矩形中添加一组坐标系与系列，不移动 top。 */
  grid(rect: Rect, xAxis: XAxis, yAxis: YAxis, series: (LineSeriesOption | BarSeriesOption)[]) {
    const index = this.grids.length;
    this.grids.push(rect);
    this.xAxes.push({ ...xAxis, gridIndex: index } as XAxis);
    this.yAxes.push({ ...yAxis, gridIndex: index } as YAxis);
    for (const item of series) this.series.push({ ...item, xAxisIndex: index, yAxisIndex: index });
  }
}

type RenderContext = {
  layout: ReportLayout;
  results: AnalyzedSampleGroup[];
  colors: string[];
  options: ResolvedSvgReportOptions;
  /** 时间轴从预热开始计时，正式测量开始于该秒数，即时间轴的起点。 */
  warmupSeconds: number;
};

function environmentSection({ layout }: RenderContext, manifest: SvgReportInput["manifest"]) {
  if (!manifest) return;
  const { environment: env, params, meta } = manifest;
  const concurrency = Array.isArray(params.concurrency) ? params.concurrency.join(" / ") : String(params.concurrency);
  const rows: [string, string][] = [];
  if (env) {
    rows.push(["Runtime", `${env.runtime} ${env.runtimeVersion} · V8 ${env.v8}`]);
    rows.push([
      "Machine",
      `${env.cpuModel} · ${env.cpuCount} logical cores · ${format(env.totalMemory / 1024 ** 3, 1)} GiB RAM · ` +
      `${env.platform} ${env.arch} ${env.osRelease}`,
    ]);
  }
  rows.push([
    "Params",
    `concurrency ${concurrency} · ${params.duration} ms per stage · warmup ${params.warmupDuration ?? 0} ms · ` +
    `sampling every ${params.intervalSample} ms${params.gc ? " · forced GC before each series" : ""}`,
  ]);
  if (meta && typeof meta === "object" && Object.keys(meta).length) {
    rows.push(["Meta", Object.entries(meta).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(" · ")]);
  }
  if (manifest.createdAt) rows.push(["Created", manifest.createdAt.replace("T", " ").replace(/\.\d+Z$/, " UTC")]);

  for (const [key, value] of rows) {
    layout.text(key, { font: `bold 12px ${FONT}`, color: MUTED_COLOR });
    layout.text(value, { x: MARGIN + 72 });
    layout.top += 18;
  }
  layout.top += 6;
}

function summarySection({ layout, results, colors, options: { labels } }: RenderContext) {
  const rows = results.map((result) => {
    const seconds = (result.run.endTime - result.run.startTime) / 1000;
    const { intervalSample } = result;
    const totalSeconds = intervalSample.intervalSeconds.reduce((sum, value) => sum + value, 0);
    const cpu = totalSeconds > 0
      ? intervalSample.cpu.reduce((sum, value, i) => sum + value * intervalSample.intervalSeconds[i], 0) / totalSeconds
      : null;
    const failed = Math.max(result.run.totalFailedSamples ?? 0, result.latency.errorCount);
    return {
      result,
      failed,
      ops: seconds > 0 ? result.latency.successCount / seconds : null,
      cpu,
      rssPeak: intervalSample.rss.length ? Math.max(...intervalSample.rss) : null,
    };
  });
  const columns: TableColumn[] = [
    { title: labels.series, width: 200 },
    { title: capitalize(labels.operations), width: 100, align: "right" },
    { title: "Errors", width: 80, align: "right" },
    { title: "Error %", width: 80, align: "right" },
    { title: labels.throughput, width: 110, align: "right" },
    { title: "vs lowest", width: 90, align: "right" },
    { title: "mean ms", width: 85, align: "right" },
    { title: "p50 ms", width: 85, align: "right" },
    { title: "p99 ms", width: 85, align: "right" },
    { title: "CPU avg %", width: 100, align: "right" },
    { title: "RSS peak MiB", width: 105, align: "right" },
  ];
  layout.heading(
    "Summary · whole measurement",
    15,
    `sorted by ${labels.throughput} high → low · vs lowest = value / lowest ${labels.throughput}`,
  );
  layout.table(
    columns,
    rankDescending(rows, (row) => row.ops).map(({ item, index, ratio }) => {
      const { latency } = item.result;
      return {
        color: colors[index],
        cells: [
          item.result.name,
          format(latency.successCount + item.failed, 0),
          format(item.failed, 0),
          format(errorRate(latency.successCount, item.failed)),
          format(item.ops, 0),
          formatRatio(ratio),
          format(latency.mean),
          format(latency.p50),
          format(latency.p99),
          format(item.cpu, 1),
          format(item.rssPeak, 1),
        ],
      };
    }),
  );
  layout.top += 8;
}

const RANKING_GAP = 24;
const RANKING_MIN_WIDTH = 260;

/**
 * 每个并发阶段一张排行表，从左到右排列，一行放不下时换行。
 * 表内按该阶段平均值从高到低排序，无数据的项排在末尾；倍数相对该阶段的最低值。
 */
function rankingTables({ layout, results, colors, options }: RenderContext, metric: IntervalMetric) {
  const stageCount = stageCountOf(results);
  if (stageCount <= 0) return;
  const perRow = Math.min(
    stageCount,
    Math.max(1, Math.floor((CONTENT_WIDTH + RANKING_GAP) / (RANKING_MIN_WIDTH + RANKING_GAP))),
  );
  const tableWidth = (CONTENT_WIDTH - RANKING_GAP * (perRow - 1)) / perRow;
  const columns: TableColumn[] = [
    { title: options.labels.series, width: tableWidth - 180 },
    { title: "Average", width: 100, align: "right" },
    { title: "vs lowest", width: 80, align: "right" },
  ];

  let rowTop = layout.top;
  let rowBottom = rowTop;
  for (let stageIndex = 0; stageIndex < stageCount; stageIndex++) {
    const column = stageIndex % perRow;
    if (column === 0 && stageIndex > 0) rowTop = rowBottom + 12;
    const left = MARGIN + column * (tableWidth + RANKING_GAP);
    const ranked = rankDescending(results, (result) => result.stages[stageIndex]?.averages[metric] ?? null);

    layout.top = rowTop;
    layout.text(`Stage #${stageIndex + 1} · concurrency ${stageConcurrency(results, stageIndex)}`, {
      x: left,
      font: `bold 12px ${FONT}`,
    });
    layout.top += ROW_HEIGHT;
    layout.table(
      columns,
      ranked.map((row) => ({
        color: colors[row.index],
        cells: [row.item.name, format(row.value), formatRatio(row.ratio)],
      })),
      left,
    );
    rowBottom = Math.max(rowBottom, layout.top);
  }
  layout.top = rowBottom + 8;
}

function throughputSection(context: RenderContext) {
  const { layout, results, colors, options } = context;
  const stageCount = stageCountOf(results);
  if (stageCount <= 0) return;
  const categories = Array.from({ length: stageCount }, (_, i) => `concurrency ${stageConcurrency(results, i)}`);
  layout.heading(
    "Throughput by concurrency",
    15,
    `successful ${options.labels.throughput} · ${BETTER_HINT.higher}`,
  );
  layout.grid(
    { left: MARGIN + 50, top: layout.top, width: CONTENT_WIDTH - 50, height: CHART_HEIGHT },
    { type: "category", data: categories },
    { type: "value", min: 0 },
    results.map((result, i): BarSeriesOption => ({
      name: result.name,
      type: "bar",
      barMaxWidth: 56,
      itemStyle: { color: colors[i] },
      label: {
        show: true,
        position: "top",
        fontSize: 10,
        color: MUTED_COLOR,
        formatter: (params: { value?: unknown }) => format(params.value as number, 0),
      },
      data: categories.map((_, stage) => result.stages[stage]?.averages.ops ?? "-"),
    })),
  );
  layout.top += CHART_HEIGHT + 36;
  if (options.rankings) rankingTables(context, "ops");
}

const DISTRIBUTION_GAP = 24;
const DISTRIBUTION_HEIGHT = 200;

/** 每个阶段一张百分位分布图；跨度超过 20 倍时使用对数纵轴，避免尾延迟压扁中位数。 */
function distributionSection({ layout, results, colors, options }: RenderContext) {
  const stageCount = stageCountOf(results);
  const points = options.distribution;
  if (stageCount <= 0 || !points.length) return;
  const perRow = Math.min(stageCount, 3);
  const width = (CONTENT_WIDTH - DISTRIBUTION_GAP * (perRow - 1)) / perRow;
  layout.heading(
    "Latency distribution by stage",
    15,
    `successful ${options.labels.operations}, ms · ${BETTER_HINT.lower}`,
  );

  let rowTop = layout.top;
  for (let stage = 0; stage < stageCount; stage++) {
    const column = stage % perRow;
    if (column === 0 && stage > 0) rowTop += DISTRIBUTION_HEIGHT + 56;
    const left = MARGIN + column * (width + DISTRIBUTION_GAP);
    const values = results.map((result) => {
      const stats = result.stages[stage]?.latency;
      return points.map((point) => stats?.[point] ?? null);
    });
    const known = values.flat().filter((value): value is number => value !== null);
    const useLog = known.length > 0 && Math.min(...known) > 0 && Math.max(...known) / Math.min(...known) >= 20;

    layout.top = rowTop;
    layout.text(
      `Stage #${stage + 1} · concurrency ${stageConcurrency(results, stage)}${useLog ? " · log scale" : ""}`,
      {
        x: left,
        font: `bold 12px ${FONT}`,
      },
    );
    layout.grid(
      { left: left + 48, top: rowTop + 24, width: width - 56, height: DISTRIBUTION_HEIGHT },
      { type: "category", boundaryGap: false, data: points.map((point) => LATENCY_LABELS[point]) },
      useLog ? { type: "log", logBase: 10 } : { type: "value", min: 0 },
      results.map((result, i): LineSeriesOption => ({
        name: result.name,
        type: "line",
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { color: colors[i] },
        itemStyle: { color: colors[i] },
        data: values[i].map((value) => value ?? "-"),
      })),
    );
  }
  layout.top = rowTop + 24 + DISTRIBUTION_HEIGHT + 32;
}

const isInstantMetric = (metric: IntervalMetric): metric is InstantMetric => metric !== "ops" && metric !== "cpu";

/** 正式测量开始时的快照下标（不晚于 startTime 的最后一个快照），用于绘制瞬时值曲线的起点；没有时返回 -1。 */
function startSnapshotIndex(result: AnalyzedSampleGroup): number {
  const { timestamp } = result.run.snapshot;
  let found = -1;
  for (let i = 0; i < timestamp.length && timestamp[i] <= result.run.startTime; i++) found = i;
  return found;
}

/**
 * 全部以折线绘制。区间平均值（ops、cpu）绘制在采样区间右端点；
 * 瞬时值（在途数、内存）绘制在各快照时刻，包含正式测量开始时的快照。
 */
function metricSeries(
  result: AnalyzedSampleGroup,
  metric: IntervalMetric,
  color: string,
  warmupSeconds: number,
): LineSeriesOption {
  const { stages, intervalSample } = result;
  const points = intervalSample.seconds.map((seconds, i) => [seconds + warmupSeconds, intervalSample[metric][i]]);
  if (isInstantMetric(metric)) {
    const start = startSnapshotIndex(result);
    if (start >= 0) points.unshift([warmupSeconds, snapshotMetric(result.run.snapshot, start, metric)]);
  }
  return {
    name: result.name,
    type: "line",
    // 在途数是离散采样值，显示采样点以免被误读为连续测量
    showSymbol: metric === "inFlight",
    symbolSize: 4,
    lineStyle: { color },
    itemStyle: { color },
    data: points,
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      data: stages.slice(1).map((stage) => ({ xAxis: stage.startSeconds + warmupSeconds })),
      lineStyle: { color, type: "dashed" },
    },
  };
}

function metricHint(metric: IntervalMetric, results: AnalyzedSampleGroup[]): string | undefined {
  if (metric === "inFlight") {
    const targets = Array.from({ length: stageCountOf(results) }, (_, i) => stageConcurrency(results, i));
    return `sampled at each snapshot · target ${targets.join(" / ")}`;
  }
  const better = METRIC_INFO[metric].better;
  return better ? BETTER_HINT[better] : undefined;
}

function timelineSection(context: RenderContext, opsRanked: boolean) {
  const { layout, results, colors, options } = context;
  for (const metric of options.metrics) {
    const info = METRIC_INFO[metric];
    const title = metric === "ops" ? `${info.title} (successful ${options.labels.throughput})` : info.title;
    layout.heading(title, 15, metricHint(metric, results));
    layout.grid(
      { left: MARGIN + 40, top: layout.top, width: CONTENT_WIDTH - 40, height: CHART_HEIGHT },
      { type: "value", min: context.warmupSeconds, axisLabel: { formatter: "{value}s" } },
      { type: "value", min: 0 },
      results.map((result, i) => metricSeries(result, metric, colors[i], context.warmupSeconds)),
    );
    layout.top += CHART_HEIGHT + 40;
    const duplicate = metric === "ops" && opsRanked;
    if (options.rankings && info.better && !duplicate && results.length) rankingTables(context, metric);
  }
}

/** 每个阶段一张表，按 latencySortBy 从高到低排序，倍数相对该阶段最低值。 */
function latencySection({ layout, results, colors, options }: RenderContext) {
  const stageCount = stageCountOf(results);
  const { latencyColumns, latencySortBy } = options;
  const sortLabel = LATENCY_LABELS[latencySortBy];
  const fixed: TableColumn[] = [
    { title: options.labels.series, width: 180 },
    { title: "success", width: 80, align: "right" },
    { title: "failed", width: 60, align: "right" },
    { title: "error %", width: 64, align: "right" },
  ];
  const fixedWidth = fixed.reduce((sum, column) => sum + column.width, 0);
  const valueWidth = Math.min(110, Math.floor((CONTENT_WIDTH - fixedWidth) / (latencyColumns.length + 1)));
  const columns: TableColumn[] = [
    ...fixed,
    ...latencyColumns.map((field) => ({ title: LATENCY_LABELS[field], width: valueWidth, align: "right" as const })),
    { title: "vs lowest", width: valueWidth, align: "right" },
  ];

  layout.heading(
    `Successful ${options.labels.operation} latency (ms)`,
    15,
    `sorted by ${sortLabel} high → low · vs lowest = ${sortLabel} / lowest ${sortLabel} · RME = 95% CI of mean (%)`,
  );
  for (let index = 0; index < stageCount; index++) {
    layout.heading(`Stage #${index + 1} · concurrency ${stageConcurrency(results, index)}`, 13);
    const stats = results.flatMap((result, i) => {
      const latency = result.stages[index]?.latency;
      return latency ? [{ index: i, latency }] : [];
    });
    layout.table(
      columns,
      rankDescending(stats, (row) => row.latency[latencySortBy]).map(({ item, ratio }) => ({
        color: colors[item.index],
        cells: [
          results[item.index].name,
          format(item.latency.successCount, 0),
          format(item.latency.errorCount, 0),
          format(errorRate(item.latency.successCount, item.latency.errorCount)),
          ...latencyColumns.map((field) => format(item.latency[field])),
          formatRatio(ratio),
        ],
      })),
    );
    layout.top += 8;
  }
}

function notesSection({ layout, options: { labels } }: RenderContext, notes: string[]) {
  layout.top += 8;
  const lines = [
    ...notes,
    `Warmup excluded. Latency is grouped by ${labels.operation} start time and includes ${labels.operations} completed during drain.`,
    'Resource curves and stage averages exclude drain. Rankings sort high → low; "vs lowest" = value / lowest value in the same table.',
  ];
  for (const line of lines) {
    layout.text(line, { color: MUTED_COLOR });
    layout.top += ROW_HEIGHT - 4;
  }
}

/**
 * 使用 ECharts SSR 生成 SVG 字符串。显示哪些区块与信息由 {@link SvgReportOptions} 控制。
 * @throws 选项名称无效时抛出，见 {@link resolveSvgReportOptions}。
 */
async function renderSvgString(input: Omit<SvgReportInput, "path">): Promise<string> {
  const { results, manifest, title = "Concurrency benchmark" } = input;
  const notes = [...input.notes ?? []];
  let options = resolveSvgReportOptions(input);
  // Deno 的 memoryUsage() 恒报告 arrayBuffers 为 0（已计入 external），此时省略该曲线以免误读为零占用
  if (
    options.metrics.includes("arrayBuffers") && results.length &&
    results.every((result) => result.intervalSample.arrayBuffers.every((value) => value === 0))
  ) {
    options = { ...options, metrics: options.metrics.filter((metric) => metric !== "arrayBuffers") };
    notes.push("ArrayBuffer memory chart omitted: the runtime reported 0 (Deno counts it in external memory).");
  }
  const sections = new Set(options.sections);
  const { init } = await import("echarts");
  const colors = results.map((_, index) => seriesColor(index));
  const layout = new ReportLayout();
  // 时间轴从预热开始计时；优先使用配置的预热时长，使各系列和档位边界对齐
  const warmupMs = manifest?.params.warmupDuration ??
    (results.length ? Math.min(...results.map((result) => result.run.warmup.duration)) : 0);
  const context: RenderContext = { layout, results, colors, options, warmupSeconds: warmupMs / 1000 };

  layout.top = 20;
  layout.text(title, { font: `bold 20px ${FONT}` });
  layout.top += 28;
  const hasTimeline = sections.has("timeline") && options.metrics.length > 0;
  layout.text(
    `Formal measurement only${
      hasTimeline ? "; time charts start at the end of warmup, dashed lines mark stage boundaries" : ""
    }.`,
    { color: MUTED_COLOR },
  );
  layout.top += 24;
  if (sections.has("environment")) environmentSection(context, manifest);
  const hasResults = results.length > 0;
  const hasCharts = hasResults && (
    sections.has("throughput") || sections.has("distribution") || hasTimeline
  );
  // 图例只用于图表；纯表格报告的行已按系列着色
  const legendTop = layout.top;
  if (hasCharts) layout.top += Math.ceil(results.length / 4) * 24 + 10;

  if (hasResults && sections.has("summary")) summarySection(context);
  if (hasResults && sections.has("throughput")) throughputSection(context);
  if (hasResults && sections.has("distribution")) distributionSection(context);
  if (hasResults && sections.has("latency")) latencySection(context);
  if (hasResults && sections.has("timeline")) {
    timelineSection(context, sections.has("throughput") && options.rankings);
  }
  if (sections.has("notes")) notesSection(context, notes);
  layout.top += 20;

  const option: EChartsOption = {
    animation: false,
    backgroundColor: "#fff",
    color: colors,
    textStyle: { fontFamily: FONT },
    legend: hasCharts
      ? { data: results.map((result) => result.name), top: legendTop, left: MARGIN, right: MARGIN }
      : { show: false },
    grid: layout.grids,
    xAxis: layout.xAxes,
    yAxis: layout.yAxes,
    series: layout.series,
    graphic: layout.graphics,
  };
  const chart = init(null, undefined, { renderer: "svg", ssr: true, width: WIDTH, height: layout.top });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

/** 生成 SVG 并写入 `input.path`，必要时创建父目录。 */
export async function renderSvg(input: SvgReportInput): Promise<void> {
  const svg = await renderSvgString(input);
  await fs.mkdir(path.dirname(input.path), { recursive: true });
  await fs.writeFile(input.path, svg);
}
