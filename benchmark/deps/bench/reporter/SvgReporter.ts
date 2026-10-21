import fs from "node:fs/promises";
import path from "node:path";
import type {
  AnalyzedSampleGroup,
  AnalyzeSampleGroupResult,
  IntervalMetric,
  IntervalSamples,
} from "../analyzer/sample_group.ts";
import type { EChartsOption, LineSeriesOption } from "echarts";

type SingleReport = {
  path: string;
  intervalSample: IntervalSamples;
  resultGroup: Map<string, AnalyzeSampleGroupResult>;
};
type ComparisonReport = {
  path: string;
  results: AnalyzedSampleGroup[];
  title?: string;
  notes?: string[];
};

const panels: { key: IntervalMetric; title: string }[] = [
  { key: "cpu", title: "CPU (% of one logical core)" },
  { key: "rss", title: "Process RSS (MiB)" },
  { key: "jsHeap", title: "JS heap used (MiB)" },
  { key: "memoryExtended", title: "External memory (MiB)" },
  { key: "qps", title: "Successful queries / second" },
  { key: "concurrency", title: "Target concurrency (not in-flight count)" },
];

const number = (value: number | null | undefined) =>
  value === null || value === undefined ? "N/A" : value.toLocaleString("en-US", { maximumFractionDigits: 3 });

/**
 * 使用 ECharts SSR 写出 SVG；只有调用时加载图表运行时，写入失败直接抛出。
 */
export async function renderSvg(input: SingleReport | ComparisonReport): Promise<void> {
  const results = "results" in input ? input.results : [{
    name: [...input.resultGroup.keys()].join(", ") || "benchmark",
    intervalSample: input.intervalSample,
    resultGroup: input.resultGroup,
    run: undefined,
  }];
  const notes = "notes" in input ? input.notes ?? [] : [];
  if (!results.length && !notes.length) throw new Error("No benchmark results to render");
  const { init } = await import("echarts");
  const colors = results.map((_, index) => `hsl(${(215 + index * 137.508) % 360}, 65%, 40%)`);
  const names = results.map((result) => result.name);
  const stageCount = Math.max(
    0,
    ...results.map((result) => result.intervalSample.stages.length),
  );
  const tableLines: { text: string; color: string }[] = [];
  for (const { key, title } of panels) {
    tableLines.push({ text: title + " | per-stage time-weighted averages", color: "#0f172a" });
    for (let stageIndex = 0; stageIndex < stageCount; stageIndex++) {
      const rows = results.map((result, index) => ({
        index,
        stage: result.intervalSample.stages[stageIndex],
        value: result.intervalSample.stages[stageIndex]?.averages[key] ?? null,
      }));
      const available = rows.flatMap((row) => row.value === null ? [] : [row.value]);
      const minimum = available.length ? Math.min(...available) : null;
      rows.sort((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity) || a.index - b.index);
      for (const row of rows) {
        const ratio = row.value !== null && minimum !== null && minimum > 0
          ? `${(row.value / minimum).toFixed(2)}x`
          : "ratio N/A";
        const target = row.stage?.concurrency;
        tableLines.push({
          text: `#${stageIndex + 1} concurrency ${target ?? "N/A"} | ${names[row.index]} | ${
            number(row.value)
          } | ${ratio}`,
          color: colors[row.index],
        });
      }
    }
  }
  tableLines.push({ text: "Successful-query latency (ms); RME = 95% mean confidence interval (%)", color: "#0f172a" });
  for (const [index, result] of results.entries()) {
    const entries = [
      ...result.resultGroup.entries(),
      ...result.intervalSample.stages.map((stage): [string, AnalyzeSampleGroupResult] => [
        `stage #${stage.index + 1} concurrency ${stage.concurrency}`,
        stage.statistics,
      ]),
    ];
    for (const [name, stats] of entries) {
      tableLines.push({
        text: `${result.name} / ${name} | success=${stats.successCount} error=${stats.errorCount} | min=${
          number(stats.min)
        } mean=${number(stats.mean)} max=${number(stats.max)} RME=${number(stats.rme)}%`,
        color: colors[index],
      }, {
        text: `  p50=${number(stats.p50)} p75=${number(stats.p75)} p90=${number(stats.p90)} p95=${
          number(stats.p95)
        } p99=${number(stats.p99)} p99.5=${number(stats.p995)} p99.9=${number(stats.p999)}`,
        color: colors[index],
      });
    }
    if (result.run) {
      const run = result.run;
      tableLines.push({
        text: `${names[index]} | warmup=${run.warmup.iterations} calls / ${number(run.warmup.duration)}ms`,
        color: colors[index],
      });
    }
  }
  for (const note of notes) tableLines.push({ text: note, color: "#475569" });
  tableLines.push({
    text:
      "Warmup excluded; latency grouped by request id and includes drain. Resource curves exclude drain; no forced GC.",
    color: "#475569",
  });
  const plotTop = 120 + Math.ceil(Math.max(1, results.length) / 4) * 24;
  const tableTop = plotTop + 3 * 300;
  const option: EChartsOption = {
    animation: false,
    backgroundColor: "#fff",
    color: colors,
    textStyle: { fontFamily: "Arial, sans-serif" },
    title: [
      {
        text: "title" in input ? input.title ?? "Concurrency benchmark" : "Concurrency benchmark",
        subtext: "Formal measurement only; dashed lines mark stage boundaries.",
        top: 20,
        left: 40,
      },
      ...panels.map((panel, index) => ({
        text: panel.title,
        top: plotTop + Math.floor(index / 2) * 300,
        left: 65 + (index % 2) * 690,
        textStyle: { fontSize: 15 },
      })),
    ],
    legend: { data: names, top: 80, left: 40, right: 40 },
    grid: panels.map((_, index) => ({
      left: 75 + (index % 2) * 690,
      top: plotTop + 40 + Math.floor(index / 2) * 300,
      width: 570,
      height: 210,
    })),
    xAxis: panels.map((_, index) => ({
      type: "value",
      gridIndex: index,
      min: 0,
      axisLabel: { formatter: "{value}s" },
    })),
    yAxis: panels.map((_, index) => ({ type: "value", gridIndex: index, min: 0 })),
    series: panels.flatMap(({ key }, panelIndex) =>
      results.map((result, index): LineSeriesOption => ({
        name: names[index],
        type: "line",
        step: key === "concurrency" ? "end" : false,
        xAxisIndex: panelIndex,
        yAxisIndex: panelIndex,
        showSymbol: false,
        data: key === "concurrency"
          ? [
            ...result.intervalSample.stages.map((stage) => [stage.startSeconds, stage.concurrency]),
            ...result.intervalSample.stages.slice(-1).map((stage) => [stage.endSeconds, stage.concurrency]),
          ]
          : result.intervalSample.seconds.map((seconds, i) => [seconds, result.intervalSample[key][i]]),
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: false },
          data: result.intervalSample.stages.slice(1).map((stage) => ({ xAxis: stage.startSeconds })),
          lineStyle: { color: colors[index], type: "dashed" },
        },
      }))
    ),
    graphic: tableLines.map((line, index) => ({
      type: "text",
      left: 40,
      top: tableTop + index * 26,
      style: { text: line.text, fill: line.color, fontSize: 12, width: 1320, overflow: "truncate" },
    })),
  };
  const chart = init(null, undefined, {
    renderer: "svg",
    ssr: true,
    width: 1420,
    height: tableTop + tableLines.length * 26 + 40,
  });
  try {
    chart.setOption(option);
    await fs.mkdir(path.dirname(input.path), { recursive: true });
    await fs.writeFile(input.path, chart.renderToSVGString());
  } finally {
    chart.dispose();
  }
}
