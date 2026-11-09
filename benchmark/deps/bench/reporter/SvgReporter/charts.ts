import type { BarSeriesOption, LineSeriesOption } from "echarts";
import {
  type AnalyzedSampleGroup,
  type InstantMetric,
  type IntervalMetric,
  snapshotMetric,
} from "../../analyzer/sample_group.ts";
import { cpuIntervals, type CpuMetric } from "../../analyzer/resource_usage.ts";
import type { RenderContext } from "./context.ts";
import {
  BETTER_HINT,
  CHART_HEIGHT,
  CONTENT_WIDTH,
  FONT,
  format,
  MARGIN,
  MUTED_COLOR,
  rankDescending,
  type Rect,
} from "./layout.ts";
import { rankingTables } from "./tables.ts";
import { stageStackedBars } from "./stacked.ts";

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

export function throughputSection(context: RenderContext) {
  const { layout, results, colors, options, stageConcurrencies } = context;
  const stageCount = stageConcurrencies.length;
  if (stageCount <= 0) return;
  const categories = stageConcurrencies.map((concurrency) => `concurrency ${concurrency}`);
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

const CPU_METRICS: readonly CpuMetric[] = ["user", "system", "total"];

export function resourceSection(context: RenderContext) {
  const { layout, results, resources, colors, options, arrayBuffersUnavailable } = context;
  layout.heading(
    "Resource consumption summary",
    15,
    `CPU: µs per completed ${options.labels.operation} · memory: time-weighted MiB`,
  );
  layout.table(
    [
      { title: options.labels.series, width: 220 },
      ...["User CPU µs/op", "System CPU µs/op", "Total CPU µs/op", "JS heap MiB", "External MiB", "ArrayBuffer MiB"]
        .map((title) => ({ title, width: 150, align: "right" as const })),
    ],
    rankDescending(resources, (resource) => resource.cpuPerOperation.total).map(({ item, index }) => ({
      color: colors[index],
      cells: [
        results[index].name,
        ...CPU_METRICS.map((metric) => format(item.cpuPerOperation[metric])),
        format(item.memory.jsHeap),
        format(item.memory.memoryExtended),
        format(arrayBuffersUnavailable ? null : item.memory.arrayBuffers),
      ],
    })),
  );
  layout.top += 12;
  const top = layout.top;
  const width = (CONTENT_WIDTH - 24) / 2;
  resourceBar(
    context,
    { left: MARGIN, top, width, height: CHART_HEIGHT },
    `Average CPU time per completed ${options.labels.operation}`,
    "µs/op",
    (index) => resources[index].cpuPerOperation.total,
  );
  resourceBar(
    context,
    { left: MARGIN + width + 24, top, width, height: CHART_HEIGHT },
    "Average process RSS",
    "MiB",
    (index) => resources[index].memory.rss,
  );
  layout.top = top + CHART_HEIGHT + 90;
}

function resourceBar(
  { layout, results, colors }: RenderContext,
  rect: Rect,
  title: string,
  unit: string,
  value: (index: number) => number | null,
) {
  layout.top = rect.top;
  layout.text(title, { x: rect.left, font: `bold 15px ${FONT}` });
  layout.top += 24;
  layout.text(`${unit} · ${BETTER_HINT.lower}`, { x: rect.left, color: MUTED_COLOR });
  layout.grid(
    { left: rect.left + 52, top: rect.top + 48, width: rect.width - 64, height: rect.height },
    {
      type: "category",
      data: results.map((result) => result.name),
      axisLabel: { interval: 0, width: Math.max(24, (rect.width - 64) / results.length - 8), overflow: "truncate" },
    },
    { type: "value", min: 0 },
    results.map((result, index): BarSeriesOption => ({
      name: result.name,
      type: "bar",
      barMaxWidth: 56,
      barGap: "-100%",
      itemStyle: { color: colors[index] },
      label: { show: true, position: "top", formatter: () => format(value(index)), color: MUTED_COLOR },
      data: results.map((_, category) => category === index ? value(index) ?? "-" : "-"),
    })),
  );
}

export function cpuSection(context: RenderContext) {
  const { layout, results, colors, options, warmupSeconds, stageResources } = context;
  if (options.metrics.includes("cpu")) {
    const metrics = ["user", "system", "total", "utilization"] as const;
    const info: Record<typeof metrics[number], { title: string; unit: string }> = {
      user: { title: "User CPU time by sampling interval", unit: "CPU time (ms)" },
      system: { title: "System CPU time by sampling interval", unit: "CPU time (ms)" },
      total: { title: "Total CPU time by sampling interval", unit: "CPU time (ms)" },
      utilization: { title: "CPU utilization", unit: "CPU (%)" },
    };
    const intervals = results.map((result) => cpuIntervals(result.run));
    for (const metric of metrics) {
      const { title, unit } = info[metric];
      layout.heading(
        title,
        15,
        metric === "utilization" ? "% of one logical core · may exceed 100%" : "interval CPU time (ms)",
      );
      layout.grid(
        { left: MARGIN + 60, top: layout.top + 24, width: CONTENT_WIDTH - 72, height: CHART_HEIGHT },
        { type: "value", min: warmupSeconds, axisLabel: { formatter: (value: number) => `${format(value, 3)}s` } },
        { type: "value", min: 0, name: unit },
        results.map((result, index): LineSeriesOption => {
          // Each value describes the whole preceding interval, not a cumulative CPU counter.
          const points = intervals[index].flatMap((interval) => [
            [interval.startSeconds + warmupSeconds, interval[metric]],
            [interval.endSeconds + warmupSeconds, interval[metric]],
          ]);
          return {
            name: result.name,
            type: "line",
            step: "end",
            showSymbol: false,
            lineStyle: { color: colors[index], width: 2 },
            itemStyle: { color: colors[index] },
            data: points,
            markLine: {
              silent: true,
              symbol: "none",
              label: { show: false },
              data: result.stages.slice(1).map((stage) => ({ xAxis: stage.startSeconds + warmupSeconds })),
              lineStyle: { color: colors[index], type: "dashed" },
            },
          };
        }),
      );
      layout.top += CHART_HEIGHT + 64;
    }
  }
  stageStackedBars(
    context,
    `CPU time per ${options.labels.operation} by stage`,
    `µs per completed ${options.labels.operation}`,
    ["User CPU", "System CPU"],
    "Total CPU",
    stageResources.map((stages) =>
      stages.map(({ cpuPerOperation: cpu }) => ({
        total: cpu.total,
        segments: cpu.user === null || cpu.system === null ? [] : [
          { value: cpu.user, shade: 0 },
          { value: cpu.system, shade: 1 },
        ],
      }))
    ),
  );
}

export const isInstantMetric = (metric: IntervalMetric): metric is InstantMetric =>
  metric !== "ops" && metric !== "cpu";

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

function metricHint(metric: IntervalMetric, stageConcurrencies: number[]): string | undefined {
  if (metric === "inFlight") {
    return `sampled at each snapshot · target ${stageConcurrencies.join(" / ")}`;
  }
  const better = METRIC_INFO[metric].better;
  return better ? BETTER_HINT[better] : undefined;
}

export function timelineSection(context: RenderContext, metrics: readonly IntervalMetric[], opsRanked: boolean) {
  const { layout, results, colors, options } = context;
  for (const metric of metrics) {
    const info = METRIC_INFO[metric];
    const title = metric === "ops" ? `${info.title} (successful ${options.labels.throughput})` : info.title;
    layout.heading(title, 15, metricHint(metric, context.stageConcurrencies));
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
