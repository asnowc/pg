import fs from "node:fs/promises";
import path from "node:path";
import type { EChartsOption, LineSeriesOption } from "echarts";
import type { AnalyzedSampleGroup, IntervalMetric, LatencyStatistics } from "../analyzer/sample_group.ts";

export type SvgPanel = {
  metric: IntervalMetric;
  title: string;
  /**
   * 图表下方的阶段平均值排行：asc 表示越小越好，desc 表示越大越好；false 不展示。
   * 行按各阶段平均值的均值排序，单元格附带与该阶段最优值的比值。
   */
  ranking: "asc" | "desc" | false;
};

export const defaultSvgPanels: readonly SvgPanel[] = [
  { metric: "concurrency", title: "Target concurrency (not in-flight count)", ranking: false },
  { metric: "qps", title: "Successful queries / second", ranking: "desc" },
  { metric: "cpu", title: "CPU (% of one logical core)", ranking: "asc" },
  { metric: "rss", title: "Process RSS (MiB)", ranking: "asc" },
  { metric: "memoryExtended", title: "External memory (MiB)", ranking: "asc" },
  { metric: "jsHeap", title: "JS heap used (MiB)", ranking: "asc" },
];

export type SvgReportInput = {
  path: string;
  results: AnalyzedSampleGroup[];
  title?: string;
  notes?: string[];
  panels?: readonly SvgPanel[];
};

type LatencyColumn = { title: string; value: (stats: LatencyStatistics) => number | null };

const latencyColumns: LatencyColumn[] = [
  { title: "p50", value: (stats) => stats.p50 },
  { title: "p75", value: (stats) => stats.p75 },
  { title: "p90", value: (stats) => stats.p90 },
  { title: "p99", value: (stats) => stats.p99 },
  { title: "mean", value: (stats) => stats.mean },
  { title: "RME %", value: (stats) => stats.rme },
];

const WIDTH = 1200;
const MARGIN = 40;
const CHART_HEIGHT = 220;
const ROW_HEIGHT = 22;
const FONT = "Arial, sans-serif";
const TEXT_COLOR = "#0f172a";
const MUTED_COLOR = "#64748b";

type Graphic = NonNullable<Extract<EChartsOption["graphic"], unknown[]>>[number];
type TableColumn = { title: string; width: number; align?: "left" | "right" };
type TableRow = { cells: string[]; color: string };

const format = (value: number | null | undefined) =>
  value === null || value === undefined ? "N/A" : value.toLocaleString("en-US", { maximumFractionDigits: 2 });

const seriesColor = (index: number) => `hsl(${(215 + index * 137.508) % 360}, 65%, 40%)`;

/** 自上而下累积 ECharts 配置，每个区块只需关心自己的高度。 */
class ReportLayout {
  top = 0;
  readonly grids: NonNullable<Extract<EChartsOption["grid"], unknown[]>> = [];
  readonly xAxes: NonNullable<Extract<EChartsOption["xAxis"], unknown[]>> = [];
  readonly yAxes: NonNullable<Extract<EChartsOption["yAxis"], unknown[]>> = [];
  readonly series: LineSeriesOption[] = [];
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

  heading(text: string, size = 15) {
    this.top += 8;
    this.text(text, { font: `bold ${size}px ${FONT}` });
    this.top += size + 12;
  }

  table(columns: TableColumn[], rows: TableRow[]) {
    const xs: number[] = [];
    let x = MARGIN;
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
      shape: { x1: MARGIN, y1: this.top, x2: Math.min(x, WIDTH - MARGIN), y2: this.top },
      style: { stroke: "#cbd5e1", lineWidth: 1 },
    });
    this.top += 4;
    for (const row of rows) {
      row.cells.forEach((cell, i) => this.text(cell, { x: xs[i], align: columns[i].align, color: row.color }));
      this.top += ROW_HEIGHT;
    }
  }

  chart(title: string, series: LineSeriesOption[], xAxisFormatter?: string) {
    const index = this.grids.length;
    this.heading(title);
    this.grids.push({ left: MARGIN + 40, top: this.top, width: WIDTH - MARGIN * 2 - 40, height: CHART_HEIGHT });
    this.xAxes.push({ type: "value", gridIndex: index, min: 0, axisLabel: { formatter: xAxisFormatter } });
    this.yAxes.push({ type: "value", gridIndex: index, min: 0 });
    for (const item of series) this.series.push({ ...item, xAxisIndex: index, yAxisIndex: index });
    this.top += CHART_HEIGHT + 40;
  }
}

function metricSeries(result: AnalyzedSampleGroup, metric: IntervalMetric, color: string): LineSeriesOption {
  const { stages, intervalSample } = result;
  const data = metric === "concurrency"
    ? [
      ...stages.map((stage) => [stage.startSeconds, stage.concurrency]),
      ...stages.slice(-1).map((stage) => [stage.endSeconds, stage.concurrency]),
    ]
    : intervalSample.seconds.map((seconds, i) => [seconds, intervalSample[metric][i]]);
  return {
    name: result.name,
    type: "line",
    step: metric === "concurrency" ? "end" : false,
    showSymbol: false,
    data,
    markLine: {
      silent: true,
      symbol: "none",
      label: { show: false },
      data: stages.slice(1).map((stage) => ({ xAxis: stage.startSeconds })),
      lineStyle: { color, type: "dashed" },
    },
  };
}

function stageColumns(stageCount: number, width: number, results: AnalyzedSampleGroup[]): TableColumn[] {
  return Array.from({ length: stageCount }, (_, index) => {
    const concurrency = results.find((result) => result.stages[index])?.stages[index].concurrency;
    return { title: `#${index + 1} c=${concurrency}`, width, align: "right" as const };
  });
}

/** 行按阶段平均值的均值排序；每格附带与该阶段最优值的比值。 */
function rankingTable(layout: ReportLayout, panel: SvgPanel, results: AnalyzedSampleGroup[], colors: string[]) {
  const direction = panel.ranking === "asc" ? 1 : -1;
  const stageCount = Math.max(...results.map((result) => result.stages.length));
  const rows = results.map((result, index) => {
    const values = Array.from({ length: stageCount }, (_, i) => result.stages[i]?.averages[panel.metric] ?? null);
    const known = values.filter((value): value is number => value !== null);
    const score = known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
    return { index, values, score };
  });
  const best = Array.from({ length: stageCount }, (_, i) => {
    const known = rows.flatMap((row) => row.values[i] === null ? [] : [row.values[i]!]);
    return known.length ? (direction > 0 ? Math.min(...known) : Math.max(...known)) : null;
  });
  rows.sort((a, b) => {
    if (a.score === null || b.score === null) return (a.score === null ? 1 : 0) - (b.score === null ? 1 : 0);
    return direction * (a.score - b.score) || a.index - b.index;
  });
  const ratio = (value: number | null, reference: number | null) =>
    value === null || reference === null || reference === 0 ? "" : ` (${(value / reference).toFixed(2)}x)`;
  layout.table(
    [{ title: "Rank / library", width: 260 }, ...stageColumns(stageCount, 140, results)],
    rows.map((row, rank) => ({
      color: colors[row.index],
      cells: [
        `${rank + 1}. ${results[row.index].name}`,
        ...row.values.map((value, i) => format(value) + ratio(value, best[i])),
      ],
    })),
  );
}

/** 每个阶段一张表，按平均延迟从高到低排序。 */
function latencyTables(layout: ReportLayout, results: AnalyzedSampleGroup[], colors: string[]) {
  const stageCount = Math.max(...results.map((result) => result.stages.length));
  const columns: TableColumn[] = [
    { title: "Library", width: 240 },
    { title: "success", width: 110, align: "right" },
    { title: "failed", width: 90, align: "right" },
    ...latencyColumns.map((column) => ({ title: column.title, width: 110, align: "right" as const })),
  ];
  for (let index = 0; index < stageCount; index++) {
    const stage = results.find((result) => result.stages[index])?.stages[index];
    layout.heading(`Stage #${index + 1} · concurrency ${stage?.concurrency}`, 13);
    const rows = results.flatMap((result, i) => {
      const stats = result.stages[index]?.latency;
      return stats ? [{ index: i, stats }] : [];
    });
    rows.sort((a, b) => (b.stats.mean ?? -Infinity) - (a.stats.mean ?? -Infinity) || a.index - b.index);
    layout.table(
      columns,
      rows.map(({ index, stats }) => ({
        color: colors[index],
        cells: [
          results[index].name,
          String(stats.successCount),
          String(stats.errorCount),
          ...latencyColumns.map((column) => format(column.value(stats))),
        ],
      })),
    );
    layout.top += 8;
  }
}

/**
 * 使用 ECharts SSR 写出 SVG。上半部分按 panels 顺序绘制资源曲线及其阶段平均值排行，
 * 下半部分按阶段列出成功请求的延迟分布。图表运行时在调用时才加载，写入失败直接抛出。
 */
export async function renderSvg(input: SvgReportInput): Promise<void> {
  const { results, notes = [], panels = defaultSvgPanels, title = "Concurrency benchmark" } = input;
  const { init } = await import("echarts");
  const colors = results.map((_, index) => seriesColor(index));
  const layout = new ReportLayout();

  layout.top = 20;
  layout.text(title, { font: `bold 18px ${FONT}` });
  layout.top += 26;
  layout.text("Formal measurement only; dashed lines mark stage boundaries.", { color: MUTED_COLOR });
  layout.top += 20;
  const legendTop = layout.top;
  layout.top += Math.ceil(Math.max(1, results.length) / 4) * 24 + 10;

  for (const panel of panels) {
    layout.chart(panel.title, results.map((result, i) => metricSeries(result, panel.metric, colors[i])), "{value}s");
    if (panel.ranking && results.length) rankingTable(layout, panel, results, colors);
  }

  layout.heading("Successful-query latency (ms); RME = 95% mean confidence interval (%)", 15);
  if (results.length) latencyTables(layout, results, colors);

  layout.top += 8;
  for (const note of notes) {
    layout.text(note, { color: MUTED_COLOR });
    layout.top += ROW_HEIGHT;
  }
  layout.text(
    "Warmup excluded; latency grouped by request id and includes drain. Resource curves exclude drain; no forced GC.",
    { color: MUTED_COLOR },
  );
  layout.top += ROW_HEIGHT + 20;

  const option: EChartsOption = {
    animation: false,
    backgroundColor: "#fff",
    color: colors,
    textStyle: { fontFamily: FONT },
    legend: { data: results.map((result) => result.name), top: legendTop, left: MARGIN, right: MARGIN },
    grid: layout.grids,
    xAxis: layout.xAxes,
    yAxis: layout.yAxes,
    series: layout.series,
    graphic: layout.graphics,
  };
  const chart = init(null, undefined, { renderer: "svg", ssr: true, width: WIDTH, height: layout.top });
  try {
    chart.setOption(option);
    await fs.mkdir(path.dirname(input.path), { recursive: true });
    await fs.writeFile(input.path, chart.renderToSVGString());
  } finally {
    chart.dispose();
  }
}
