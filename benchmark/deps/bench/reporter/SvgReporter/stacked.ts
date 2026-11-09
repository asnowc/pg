import type { BarSeriesOption } from "echarts";
import type { AnalyzedSampleGroup } from "../../analyzer/sample_group.ts";
import type { RenderContext } from "./context.ts";
import { BETTER_HINT, CHART_HEIGHT, CONTENT_WIDTH, FONT, format, MARGIN, MUTED_COLOR } from "./layout.ts";

export type StackedBar = { segments: { value: number; shade: number }[]; total: number | null };

export function stackedSeries(
  results: AnalyzedSampleGroup[],
  colors: string[],
  bars: (StackedBar | undefined)[],
  gridIndex: number,
  shadeCount: number,
  labelPosition: "top" | "right",
): BarSeriesOption[] {
  return results.flatMap((result, index) => {
    const bar = bars[index];
    if (!bar || bar.total === null) return [];
    return bar.segments.map((segment, part): BarSeriesOption => ({
      name: result.name,
      type: "bar",
      stack: `grid-${gridIndex}-series-${index}`,
      barGap: "-100%",
      barMaxWidth: labelPosition === "right" ? 16 : 48,
      itemStyle: {
        color: colors[index],
        opacity: 1 - segment.shade / Math.max(1, shadeCount - 1) * 0.6,
        borderColor: "#fff",
        borderWidth: 1.5,
      },
      label: {
        show: part === bar.segments.length - 1,
        position: labelPosition,
        color: MUTED_COLOR,
        opacity: 1,
        fontSize: 10,
        formatter: () => format(bar.total),
      },
      data: results.map((_, category) => category === index ? segment.value : "-"),
    }));
  });
}

export function stageStackedBars(
  { layout, results, colors, stageConcurrencies }: RenderContext,
  title: string,
  unit: string,
  segmentLabels: string[],
  totalLabel: string,
  data: StackedBar[][],
) {
  const stageCount = stageConcurrencies.length;
  if (!stageCount) return;
  const gap = 24;
  const minimumWidth = Math.max(260, 100 + results.length * 64);
  const perRow = Math.min(stageCount, Math.max(1, Math.floor((CONTENT_WIDTH + gap) / (minimumWidth + gap))));
  const width = (CONTENT_WIDTH - gap * (perRow - 1)) / perRow;
  const known = data.flat().flatMap((bar) => bar.total === null ? [] : [bar.total]);
  const largest = Math.max(0, ...known);
  const max = largest > 0 ? largest * 1.15 : 1;
  layout.heading(title, 15, `${unit} · ${BETTER_HINT.lower}`);
  layout.text(`Segments (dark → light): ${segmentLabels.join(" / ")} · top = ${totalLabel}`, { color: MUTED_COLOR });
  layout.top += 26;

  const top = layout.top;
  const rowHeight = CHART_HEIGHT + 84;
  for (let stage = 0; stage < stageCount; stage++) {
    const column = stage % perRow;
    const left = MARGIN + column * (width + gap);
    const rowTop = top + Math.floor(stage / perRow) * rowHeight;
    layout.top = rowTop;
    layout.text(`Stage #${stage + 1} · concurrency ${stageConcurrencies[stage]}`, {
      x: left,
      font: `bold 12px ${FONT}`,
    });
    const plotWidth = width - 60;
    const gridIndex = layout.grids.length;
    layout.grid(
      { left: left + 48, top: rowTop + 28, width: plotWidth, height: CHART_HEIGHT },
      {
        type: "category",
        data: results.map((result) => result.name),
        axisLabel: { interval: 0, width: Math.max(24, plotWidth / results.length - 8), overflow: "truncate" },
      },
      { type: "value", min: 0, max, axisLabel: { formatter: (value: number) => format(value) } },
      stackedSeries(results, colors, data.map((stages) => stages[stage]), gridIndex, segmentLabels.length, "top"),
    );
    results.forEach((_, index) => {
      if (data[index]?.[stage]?.total != null) return;
      layout.top = rowTop + 28 + CHART_HEIGHT / 2;
      layout.text("N/A", { x: left + 48 + plotWidth * (index + 0.5) / results.length - 12, color: MUTED_COLOR });
    });
  }
  layout.top = top + Math.ceil(stageCount / perRow) * rowHeight;
}
