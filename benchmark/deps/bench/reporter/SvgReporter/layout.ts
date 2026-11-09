import type { BarSeriesOption, EChartsOption, LineSeriesOption } from "echarts";

export const WIDTH = 1200;
export const MARGIN = 40;
export const CONTENT_WIDTH = WIDTH - MARGIN * 2;
export const CHART_HEIGHT = 220;
export const ROW_HEIGHT = 22;
export const FONT = "Arial, sans-serif";
export const TEXT_COLOR = "#0f172a";
export const MUTED_COLOR = "#64748b";
export const BETTER_HINT = { higher: "higher is better", lower: "lower is better" };

type Graphic = NonNullable<Extract<EChartsOption["graphic"], unknown[]>>[number];
type XAxis = NonNullable<Extract<EChartsOption["xAxis"], unknown[]>>[number];
type YAxis = NonNullable<Extract<EChartsOption["yAxis"], unknown[]>>[number];
export type Rect = { left: number; top: number; width: number; height: number };
export type TableColumn = { title: string; width: number; align?: "left" | "right" };
type TableRow = { cells: string[]; color: string };

const numberFormatters = new Map<number, Intl.NumberFormat>();

export function format(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "N/A";
  let formatter = numberFormatters.get(digits);
  if (!formatter) {
    formatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: digits });
    numberFormatters.set(digits, formatter);
  }
  return formatter.format(value);
}

export const seriesColor = (index: number) => `hsl(${(215 + index * 137.508) % 360}, 65%, 40%)`;

type Ranked<T> = { item: T; index: number; value: number | null; ratio: number | null };

/**
 * 按数值从高到低排序（无数据的项排在末尾，同值保持原顺序），
 * 并计算每项相对于最低值的倍数；最低值为 0 时只有同为 0 的项有倍数。
 */
export function rankDescending<T>(items: readonly T[], value: (item: T) => number | null): Ranked<T>[] {
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

export const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const formatRatio = (ratio: number | null) => ratio === null ? "N/A" : `${ratio.toFixed(2)}x`;

export const errorRate = (success: number, failed: number) =>
  success + failed > 0 ? failed / (success + failed) * 100 : null;

/** 自上而下累积 ECharts 配置，每个区块只需关心自己的高度。 */
export class ReportLayout {
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
  grid(rect: Rect, xAxis: XAxis, yAxis: YAxis | YAxis[], series: (LineSeriesOption | BarSeriesOption)[]) {
    const index = this.grids.length;
    const xIndex = this.xAxes.length;
    const yIndex = this.yAxes.length;
    this.grids.push(rect);
    this.xAxes.push({ ...xAxis, gridIndex: index } as XAxis);
    for (const axis of Array.isArray(yAxis) ? yAxis : [yAxis]) {
      this.yAxes.push({ ...axis, gridIndex: index } as YAxis);
    }
    for (const item of series) {
      this.series.push({ ...item, xAxisIndex: xIndex, yAxisIndex: yIndex + (item.yAxisIndex ?? 0) });
    }
  }
}
