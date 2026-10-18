export interface ResourceSample {
  seconds: number;
  intervalSeconds: number;
  cpuPercent: number;
  rssMiB: number;
  heapMiB: number;
  externalMiB: number;
  successQps: number;
  droppedQps: number;
  errorQps: number;
  inFlight: number;
  concurrency: number;
}

interface ResourceResultBase {
  library: string;
  pid: number;
  denoVersion: string;
  poolSize: number;
  maxInFlight: number;
  elapsedSeconds: number;
  scheduled: number;
  started: number;
  succeeded: number;
  failed: number;
  dropped: number;
  inFlightAtEnd: number;
  drained: boolean;
  cpuUs: number;
  firstError?: string;
  drainError?: string;
  samples: ResourceSample[];
}

export interface ConcurrencyDecision {
  seconds: number;
  previous: number;
  next: number;
  qps: number;
  baselineQps: number;
  action: "probe" | "accept" | "revert";
  step: number;
  nextStep: number;
  phase: "coarse" | "refine";
  gainThresholdPercent: number;
  converged: boolean;
}

export interface ConcurrencyEstimate {
  seconds: number;
  concurrency: number;
  completed: number;
  elapsedSeconds: number;
  cpuUs: number;
  averageLatencyMs: number | null;
  cpuUsPerQuery: number | null;
  estimatedConcurrency: number | null;
  nextConcurrency: number;
  reason?: string;
}

export interface AdaptiveResourceResult extends ResourceResultBase {
  qps: null;
  steadyDuration: number;
  searchTimeout: number;
  searchConverged: boolean;
  searchCompletedAtSeconds: number | null;
  convergedConcurrency: number | null;
  steadyElapsedSeconds: number;
  steadyCompleted: number;
  steadyAverageQps: number | null;
  searchError?: string;
  minConcurrency: number;
  initialConcurrency: number;
  finalConcurrency: number;
  tuneInterval: number;
  minGainPercent: number;
  completedInWindow: number;
  averageQps: number;
  peakQps: number;
  peakConcurrency: number | null;
  decisions: ConcurrencyDecision[];
  estimates: ConcurrencyEstimate[];
}

function postSearchAverage(result: AdaptiveResourceResult, key: keyof ResourceSample): number | null {
  const start = result.searchCompletedAtSeconds;
  if (!result.searchConverged || start === null) return null;
  let total = 0;
  let seconds = 0;
  for (const sample of result.samples) {
    const interval = Math.max(
      0,
      Math.min(sample.seconds, result.elapsedSeconds) - Math.max(start, sample.seconds - sample.intervalSeconds),
    );
    total += sample[key] * interval;
    seconds += interval;
  }
  return seconds > 0 ? total / seconds : null;
}

export async function renderResourceChart(results: AdaptiveResourceResult[]): Promise<string> {
  if (results.length === 0) throw new Error("Cannot chart an empty result set");
  // Keep the charting runtime out of measured worker processes.
  const { init, format } = await import("echarts");
  const first = results[0];
  const duration = Math.max(1, Math.ceil(Math.max(...results.map((result) => result.elapsedSeconds))));
  // Golden-angle hues avoid cycling a fixed palette as libraries are added.
  const colors = results.map((_, index) => `hsl(${(215 + index * 137.508) % 360}, 65%, 40%)`);
  const panels: { key: keyof ResourceSample; title: string; unit: string }[] = [
    { key: "cpuPercent", title: "CPU (% of one logical core)", unit: "%" },
    { key: "rssMiB", title: "Process RSS (MiB)", unit: " MiB" },
    { key: "heapMiB", title: "JS heap used (MiB)", unit: " MiB" },
    { key: "externalMiB", title: "External memory (MiB)", unit: " MiB" },
    { key: "successQps", title: "Successful queries / second", unit: "/s" },
    { key: "inFlight", title: "In-flight queries (concurrency)", unit: "" },
  ];
  const names = results.map((result) =>
    `${result.library}${result.failed > 0 || !result.drained || !result.searchConverged ? " (ERROR)" : ""}`
  );
  const failureLabels = results.map((result, index) =>
    `${names[index]}: ${result.failed.toLocaleString("en-US")} failed`
  );
  const summaries = panels.map(({ key, unit }) => {
    const averages = results.map((result) => postSearchAverage(result, key));
    const available = averages.filter((value): value is number => value !== null);
    const minimum = available.length > 0 ? Math.min(...available) : null;
    return names.map((name, resultIndex) => {
      const average = averages[resultIndex];
      const ratio = average !== null && minimum !== null && minimum > 0
        ? `${(average / minimum).toFixed(2)}x`
        : "ratio N/A";
      return average === null
        ? `${name}: no post-search data`
        : `${name}: ${
          average.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }${unit} (${ratio})`;
    });
  });
  const summaryColumnWidth = Math.max(
    255,
    ...summaries.flat().map((text) => Math.ceil(format.getTextRect(text, "11px Arial, sans-serif").width) + 16),
  );
  const panelWidth = summaryColumnWidth * 2;
  const panelStride = panelWidth + 120;
  const chartWidth = panelWidth * 2 + 260;
  const legendItemWidth = Math.max(
    150,
    ...[...names, ...failureLabels].map((text) =>
      Math.ceil(format.getTextRect(text, "12px Arial, sans-serif").width) + 48
    ),
  );
  const legendColumns = Math.max(1, Math.floor((chartWidth - 64) / legendItemWidth));
  const panelTop = 88 + Math.ceil(names.length / legendColumns) * 24;
  const rowHeight = 300 + Math.ceil(results.length / 2) * 20;
  const failuresTop = panelTop + Math.ceil(panels.length / 2) * rowHeight + 8;
  const footerTop = failuresTop + 48 + Math.ceil(results.length / legendColumns) * 24;
  const option: EChartsOption = {
    animation: false,
    backgroundColor: "#fff",
    textStyle: { fontFamily: "Arial, sans-serif", color: "#1e293b" },
    color: colors,
    title: [
      {
        text: `Adaptive max-QPS | pool ${first.poolSize} | concurrency ${first.minConcurrency}-${first.maxInFlight}`,
        subtext:
          "Independent processes; 1-second samples; CPU 100% = one logical core. Memory includes the load generator.",
        left: 32,
        top: 16,
        textStyle: { fontSize: 20 },
        subtextStyle: { color: "#1e293b", fontSize: 12 },
      },
      ...panels.map(({ title }, index) => ({
        text: title,
        left: 82 + (index % 2) * panelStride,
        top: panelTop + Math.floor(index / 2) * rowHeight,
        textStyle: { fontSize: 15 },
      })),
    ],
    legend: names.map((name, index) => ({
      data: [name],
      left: 32 + (index % legendColumns) * legendItemWidth,
      top: 72 + Math.floor(index / legendColumns) * 24,
      textStyle: { fontSize: 12 },
      selectedMode: false,
    })),
    grid: panels.map((_, index) => ({
      left: 82 + (index % 2) * panelStride,
      top: panelTop + 33 + Math.floor(index / 2) * rowHeight,
      width: panelWidth,
      height: 215,
    })),
    xAxis: panels.map((_, index): XAXisComponentOption => ({
      type: "value",
      gridIndex: index,
      min: 0,
      max: duration,
      splitNumber: 4,
      axisLabel: { formatter: "{value}s" },
      splitLine: { show: false },
      axisLine: { show: true, lineStyle: { color: "#94a3b8" } },
    })),
    yAxis: panels.map(({ key }, index): YAXisComponentOption => {
      let max = 1;
      for (const result of results) {
        for (const sample of result.samples) max = Math.max(max, sample[key]);
      }
      return {
        type: "value",
        gridIndex: index,
        min: 0,
        max: max * 1.1,
        splitNumber: 4,
        axisLabel: { formatter: (value: number) => value.toFixed(value < 10 ? 1 : 0) },
        splitLine: { lineStyle: { color: "#e2e8f0" } },
      };
    }),
    series: panels.flatMap(({ key }, panelIndex) =>
      results.map((result, resultIndex): LineSeriesOption => {
        return {
          type: "line",
          name: names[resultIndex],
          xAxisIndex: panelIndex,
          yAxisIndex: panelIndex,
          symbol: "circle",
          symbolSize: 4,
          showSymbol: true,
          lineStyle: { width: 2, color: colors[resultIndex] },
          itemStyle: { color: colors[resultIndex] },
          data: result.samples
            .filter((sample) => sample.seconds > 0 || (key !== "cpuPercent" && !key.endsWith("Qps")))
            .map((sample) => [Math.min(sample.seconds, duration), sample[key]]),
          markLine: result.searchConverged && result.searchCompletedAtSeconds !== null
            ? {
              silent: true,
              symbol: "none",
              precision: 20,
              label: { show: false },
              lineStyle: { color: colors[resultIndex], type: "dashed" },
              data: [{ xAxis: result.searchCompletedAtSeconds }],
            }
            : undefined,
        };
      })
    ),
    graphic: [
      ...summaries.flatMap((labels, panelIndex) =>
        labels.map((text, resultIndex) => ({
          type: "text" as const,
          left: 82 + (panelIndex % 2) * panelStride + (resultIndex % 2) * summaryColumnWidth,
          top: panelTop + 282 + Math.floor(panelIndex / 2) * rowHeight + Math.floor(resultIndex / 2) * 20,
          style: { text, fill: colors[resultIndex], fontSize: 11, fontFamily: "Arial, sans-serif" },
        }))
      ),
      {
        type: "text",
        left: 32,
        top: failuresTop,
        style: {
          text: "Failed queries (entire run, including drain)",
          fill: "#1e293b",
          fontSize: 13,
          fontFamily: "Arial, sans-serif",
        },
      },
      ...failureLabels.map((text, index) => ({
        type: "text" as const,
        left: 32 + (index % legendColumns) * legendItemWidth,
        top: failuresTop + 28 + Math.floor(index / legendColumns) * 24,
        style: { text, fill: colors[index], fontSize: 12, fontFamily: "Arial, sans-serif" },
      })),
      {
        type: "text",
        left: 32,
        top: footerTop,
        style: {
          text: "Bottom labels = post-search time-weighted means and ratios to the panel minimum.\n" +
            "Vertical dashes start post-search timing; drain excluded. Ratios are N/A when the minimum is zero or unavailable.",
          fill: "#1e293b",
          fontSize: 12,
          lineHeight: 18,
        },
      },
    ],
  };
  const chart = init(null, undefined, { renderer: "svg", ssr: true, width: chartWidth, height: footerTop + 60 });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}
import type { EChartsOption, LineSeriesOption, XAXisComponentOption, YAXisComponentOption } from "echarts";
