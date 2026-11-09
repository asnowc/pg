import type { IntervalMetric } from "../../analyzer/sample_group.ts";
import type { SvgReportInput } from "./options.ts";
import { LATENCY_LABELS } from "./options.ts";
import type { RenderContext } from "./context.ts";
import {
  capitalize,
  CONTENT_WIDTH,
  errorRate,
  FONT,
  format,
  formatRatio,
  MARGIN,
  MUTED_COLOR,
  rankDescending,
  ROW_HEIGHT,
  type TableColumn,
} from "./layout.ts";

export function environmentSection({ layout }: RenderContext, manifest: SvgReportInput["manifest"]) {
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

export function summarySection({ layout, results, colors, options: { labels } }: RenderContext) {
  const rows = results.map((result) => {
    const seconds = (result.run.endTime - result.run.startTime) / 1000;
    const failed = Math.max(result.run.totalFailedSamples ?? 0, result.latency.errorCount);
    return {
      result,
      failed,
      ops: seconds > 0 ? result.latency.successCount / seconds : null,
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
export function rankingTables(
  { layout, results, colors, options, stageConcurrencies }: RenderContext,
  metric: IntervalMetric,
) {
  const stageCount = stageConcurrencies.length;
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
    layout.text(`Stage #${stageIndex + 1} · concurrency ${stageConcurrencies[stageIndex]}`, {
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

/** 每个阶段一张表，按 latencySortBy 从高到低排序，倍数相对该阶段最低值。 */
export function latencySection({ layout, results, colors, options, stageConcurrencies }: RenderContext) {
  const stageCount = stageConcurrencies.length;
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
    layout.heading(`Stage #${index + 1} · concurrency ${stageConcurrencies[index]}`, 13);
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

export function notesSection({ layout, options: { labels } }: RenderContext, notes: string[]) {
  layout.top += 8;
  const lines = [
    ...notes,
    `Warmup excluded. Latency is grouped by ${labels.operation} start time and includes ${labels.operations} completed during drain.`,
    'Resource curves and stage averages exclude drain. Rankings sort high → low; "vs lowest" = value / lowest value in the same table.',
    `CPU per ${labels.operation} uses snapshot completion deltas (success + error); memory is time-weighted using right-end snapshots.`,
    "CPU time uses adjacent snapshot deltas. Resource memory averages exclude warmup and drain.",
    "Stacked CPU: User + System = Total. Stacked latency: adjacent selected-value increments, not percentile sums.",
    "Window boundaries prorate CPU and completion deltas. No coverage or no completions: N/A.",
  ];
  for (const line of lines) {
    layout.text(line, { color: MUTED_COLOR });
    layout.top += ROW_HEIGHT - 4;
  }
}
