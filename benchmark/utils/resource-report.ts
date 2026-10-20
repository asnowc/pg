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
  samples: ResourceSample[];
}

export interface ConcurrencyStage {
  concurrency: number;
  startSeconds: number;
  endSeconds: number;
  elapsedSeconds: number;
  completedInWindow: number;
  averageQps: number;
}

export interface ResourceResult extends ResourceResultBase {
  qps: null;
  concurrency: number[];
  duration: number;
  warmup: number;
  warmupCompletedAtSeconds: number | null;
  measurementElapsedSeconds: number;
  stages: ConcurrencyStage[];
  completedInWindow: number;
  averageQps: number | null;
  peakQps: number;
}

function measurementAverage(
  result: ResourceResult,
  key: keyof ResourceSample,
  stage: ConcurrencyStage | undefined,
): number | null {
  if (!stage) return null;
  let total = 0;
  let seconds = 0;
  for (const sample of result.samples) {
    const interval = Math.max(
      0,
      Math.min(sample.seconds, stage.endSeconds) -
        Math.max(stage.startSeconds, sample.seconds - sample.intervalSeconds),
    );
    total += sample[key] * interval;
    seconds += interval;
  }
  return seconds > 0 ? total / seconds : null;
}

export async function renderResourceChart(results: ResourceResult[]): Promise<string> {
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
  const names = results.map((result) => `${result.library}${result.failed > 0 || !result.drained ? " (ERROR)" : ""}`);
  const failureLabels = results.map((result, index) =>
    `${names[index]}: ${result.failed.toLocaleString("en-US")} failed`
  );
  const tables = panels.map(({ key, unit }) =>
    first.concurrency.map((concurrency, stageIndex) => {
      const averages = results.map((result) => measurementAverage(result, key, result.stages[stageIndex]));
      const available = averages.filter((value): value is number => value !== null);
      const minimum = available.length > 0 ? Math.min(...available) : null;
      const rows = names.map((name, resultIndex) => {
        const average = averages[resultIndex];
        const ratio = average !== null && minimum !== null && minimum > 0
          ? `${(average / minimum).toFixed(2)}x`
          : "ratio N/A";
        const averageText = average === null
          ? "no measurement data"
          : `${average.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unit}`;
        return { name, average, averageText, ratio, resultIndex };
      });
      rows.sort((a, b) => {
        if (a.average === b.average) return a.resultIndex - b.resultIndex;
        if (a.average === null) return 1;
        if (b.average === null) return -1;
        return a.average - b.average;
      });
      return { title: `#${stageIndex + 1} concurrency ${concurrency}`, rows };
    })
  );
  const headers = ["Library", "Average", "vs minimum"];
  const tableRows = tables.flat().flatMap((table) => table.rows.map((row) => [row.name, row.averageText, row.ratio]));
  const columnWidths = headers.map((header, column) =>
    Math.ceil(Math.max(
      format.getTextRect(header, "bold 12px Arial, sans-serif").width,
      ...tableRows.map((row) => format.getTextRect(row[column], "11px Arial, sans-serif").width),
    )) + 24
  );
  const panelWidth = Math.max(510, columnWidths.reduce((sum, width) => sum + width, 0));
  columnWidths[0] += panelWidth - columnWidths.reduce((sum, width) => sum + width, 0);
  const columnOffsets = columnWidths.map((_, index) =>
    columnWidths.slice(0, index).reduce((sum, width) => sum + width, 0)
  );
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
  const tableRowHeight = 20;
  const tableStride = 24 + (results.length + 1) * tableRowHeight + 16;
  const rowHeight = 300 + first.concurrency.length * tableStride;
  const failuresTop = panelTop + Math.ceil(panels.length / 2) * rowHeight + 8;
  const footerTop = failuresTop + 48 + Math.ceil(results.length / legendColumns) * 24;
  const option: EChartsOption = {
    animation: false,
    backgroundColor: "#fff",
    textStyle: { fontFamily: "Arial, sans-serif", color: "#1e293b" },
    color: colors,
    title: [
      {
        text: `Fixed concurrency | pool ${first.poolSize} | concurrency ${
          first.concurrency.join(",")
        } | warmup ${first.warmup}s`,
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
          markLine: result.warmupCompletedAtSeconds === null ? undefined : {
            silent: true,
            symbol: "none",
            label: { show: false },
            lineStyle: { color: colors[resultIndex], type: "dashed" },
            data: result.stages.map((stage) => ({ xAxis: stage.startSeconds })),
          },
        };
      })
    ),
    graphic: [
      ...tables.flatMap((panelTables, panelIndex) =>
        panelTables.map((table, tableIndex) => ({
          type: "group" as const,
          left: 82 + (panelIndex % 2) * panelStride,
          top: panelTop + 282 + Math.floor(panelIndex / 2) * rowHeight + tableIndex * tableStride,
          children: [
            {
              type: "text" as const,
              style: {
                text: table.title,
                fill: "#334155",
                fontSize: 12,
                fontWeight: "bold" as const,
                fontFamily: "Arial, sans-serif",
              },
            },
            ...[
              { cells: headers, color: "#334155" },
              ...table.rows.map((row) => ({
                cells: [row.name, row.averageText, row.ratio],
                color: colors[row.resultIndex],
              })),
            ].flatMap((row, rowIndex) =>
              row.cells.flatMap((text, columnIndex) => [
                {
                  type: "rect" as const,
                  shape: {
                    x: columnOffsets[columnIndex],
                    y: 24 + rowIndex * tableRowHeight,
                    width: columnWidths[columnIndex],
                    height: tableRowHeight,
                  },
                  style: {
                    fill: rowIndex === 0 ? "#e2e8f0" : rowIndex % 2 === 0 ? "#f8fafc" : "#fff",
                    stroke: "#cbd5e1",
                    lineWidth: 1,
                  },
                },
                {
                  type: "text" as const,
                  x: columnOffsets[columnIndex] + (columnIndex === 0 ? 12 : columnWidths[columnIndex] - 12),
                  y: 24 + (rowIndex + 0.5) * tableRowHeight,
                  style: {
                    text,
                    fill: row.color,
                    fontSize: rowIndex === 0 ? 12 : 11,
                    fontWeight: rowIndex === 0 ? "bold" as const : "normal" as const,
                    fontFamily: "Arial, sans-serif",
                    align: columnIndex === 0 ? "left" as const : "right" as const,
                    verticalAlign: "middle" as const,
                  },
                },
              ])
            ),
          ],
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
          text:
            "Tables = per-stage time-weighted means, sorted ascending, and ratios to the same-stage panel minimum.\n" +
            "Vertical dashes mark warmup completion and stage starts; warmup and final drain excluded from averages.",
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
