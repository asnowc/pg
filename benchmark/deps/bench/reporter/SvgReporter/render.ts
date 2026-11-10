import fs from "node:fs/promises";
import path from "node:path";
import type { EChartsOption } from "echarts";
import { resolveSvgReportOptions, type SvgReportInput } from "./options.ts";
import { createRenderContext } from "./context.ts";
import { FONT, MARGIN, MUTED_COLOR, ReportLayout, seriesColor, WIDTH } from "./layout.ts";
import { cpuSection, isInstantMetric, resourceSection, throughputSection, timelineSection } from "./charts.ts";
import { environmentSection, latencySection, notesSection, summarySection } from "./tables.ts";
import { distributionSection } from "./latency.ts";

/**
 * 使用 ECharts SSR 生成 SVG 字符串。显示哪些区块与信息由 {@link SvgReportOptions} 控制。
 * @throws 选项名称无效时抛出，见 {@link resolveSvgReportOptions}。
 */
async function renderSvgString(input: Omit<SvgReportInput, "path">): Promise<string> {
  const { results, manifest, title = "Concurrency benchmark" } = input;
  const notes = [...input.notes ?? []];
  let options = resolveSvgReportOptions(input);
  // Deno 的 memoryUsage() 恒报告 arrayBuffers 为 0（已计入 external），此时省略该曲线以免误读为零占用
  const arrayBuffersUnavailable = results.length > 0 &&
    results.every((result) =>
      result.run.snapshot.arrayBuffers.length > 0 &&
      result.run.snapshot.arrayBuffers.every((value) => value === 0)
    );
  if (arrayBuffersUnavailable && (options.metrics.includes("arrayBuffers") || options.sections.includes("resource"))) {
    options = { ...options, metrics: options.metrics.filter((metric) => metric !== "arrayBuffers") };
    notes.push("ArrayBuffer memory unavailable (N/A): the runtime reported 0 (Deno counts it in external memory).");
  }
  const sections = new Set(options.sections);
  const { init } = await import("echarts");
  const colors = results.map((_, index) => seriesColor(index));
  const layout = new ReportLayout();
  // 时间轴从预热开始计时；优先使用配置的预热时长，使各系列和档位边界对齐
  const warmupMs = manifest?.params.warmupDuration ??
    (results.length ? Math.min(...results.map((result) => result.run.warmup.duration)) : 0);
  const context = createRenderContext({
    layout,
    results,
    colors,
    options,
    warmupSeconds: warmupMs / 1000,
    arrayBuffersUnavailable,
  });

  layout.top = 20;
  layout.text(title, { font: `bold 20px ${FONT}` });
  layout.top += 28;
  const operationMetrics = options.metrics.filter((metric) => metric === "inFlight" || metric === "ops");
  const memoryMetrics = options.metrics.filter((metric) => isInstantMetric(metric) && metric !== "inFlight");
  const hasTimeline = (sections.has("cpu") && options.metrics.includes("cpu")) ||
    (sections.has("memory") && memoryMetrics.length > 0) ||
    (sections.has("throughput") && operationMetrics.length > 0);
  layout.text(
    `Formal measurement only${
      hasTimeline ? "; resource timelines start at the end of warmup, dashed lines mark stage boundaries" : ""
    }.`,
    { color: MUTED_COLOR },
  );
  layout.top += 24;
  if (sections.has("environment")) environmentSection(context, manifest);
  const hasResults = results.length > 0;
  const hasCharts = hasResults && (
    sections.has("throughput") || sections.has("distribution") || sections.has("resource") ||
    sections.has("cpu") || hasTimeline
  );
  // 图例只用于图表；纯表格报告的行已按系列着色
  const legendTop = layout.top;
  if (hasCharts) layout.top += Math.ceil(results.length / 4) * 24 + 10;

  if (hasResults && sections.has("summary")) summarySection(context);
  if (hasResults && sections.has("throughput")) {
    throughputSection(context);
    timelineSection(context, operationMetrics);
  }
  if (hasResults && sections.has("latency")) latencySection(context);
  if (hasResults && sections.has("distribution")) distributionSection(context);
  if (hasResults && sections.has("resource")) resourceSection(context);
  if (hasResults && sections.has("cpu")) cpuSection(context);
  if (hasResults && sections.has("memory")) timelineSection(context, memoryMetrics);
  if (sections.has("notes")) notesSection(context, notes);
  layout.top += 20;

  const legendNames = new Set(layout.series.map((series) => series.name));
  const option: EChartsOption = {
    animation: false,
    backgroundColor: "#fff",
    color: colors,
    textStyle: { fontFamily: FONT },
    legend: hasCharts && legendNames.size > 0
      ? {
        data: results.map((result) => result.name).filter((name) => legendNames.has(name)),
        top: legendTop,
        left: MARGIN,
        right: MARGIN,
      }
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
