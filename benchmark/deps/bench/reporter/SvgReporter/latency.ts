import type { RenderContext } from "./context.ts";
import { LATENCY_LABELS } from "./options.ts";
import { BETTER_HINT, CONTENT_WIDTH, FONT, format, MARGIN, MUTED_COLOR } from "./layout.ts";
import { type StackedBar, stackedSeries } from "./stacked.ts";

export function distributionSection(context: RenderContext) {
  const { layout, results, colors, options, stageConcurrencies } = context;
  const points = [...new Set(options.distribution)];
  const stageCount = stageConcurrencies.length;
  if (!points.length || !stageCount) return;
  const data = results.map((result) =>
    result.stages.map((stage): StackedBar => {
      const values = points.flatMap((point, shade) => {
        const value = stage.latency[point];
        return value === null ? [] : [{ value, shade }];
      }).sort((a, b) => a.value - b.value);
      let previous = 0;
      const segments = values.map(({ value, shade }) => {
        const increment = value - previous;
        previous = value;
        return { value: increment, shade };
      });
      return { segments, total: values.at(-1)?.value ?? null };
    })
  );
  layout.heading(
    "Latency distribution by stage",
    15,
    `successful ${options.labels.operations}, ms · ${BETTER_HINT.lower}`,
  );
  layout.text(
    `Segments (dark → light): ${
      points.map((point) => LATENCY_LABELS[point]).join(" / ")
    } · end = highest selected value`,
    { color: MUTED_COLOR },
  );
  layout.top += 24;
  const rowHeight = 22;
  const nameWidth = Math.min(220, Math.max(80, ...results.map((result) => result.name.length * 7 + 8)));
  const height = results.length * rowHeight;
  for (let stage = 0; stage < stageCount; stage++) {
    const minimums = results.flatMap((result) => {
      const minimum = result.stages[stage]?.latency.min;
      return minimum == null ? [] : [minimum];
    });
    const origin = minimums.length ? Math.min(...minimums) : 0;
    const bars = data.map((stages) => stages[stage]);
    const highest = Math.max(origin, ...bars.flatMap((bar) => bar?.total == null ? [] : [bar.total]));
    const range = highest - origin;
    const max = origin + (range > 0 ? range * 1.08 : Math.max(Math.abs(origin) * 0.05, 1));
    layout.text(`Stage #${stage + 1} · concurrency ${stageConcurrencies[stage]}`, {
      font: `bold 12px ${FONT}`,
    });
    const top = layout.top + 20;
    const left = MARGIN + nameWidth;
    const gridIndex = layout.grids.length;
    layout.grid(
      { left, top, width: CONTENT_WIDTH - nameWidth - 64, height },
      {
        type: "value",
        min: origin,
        max,
        splitNumber: 6,
        axisLabel: {
          formatter: (value: number) => format(value),
          showMinLabel: true,
          showMaxLabel: false,
          hideOverlap: true,
        },
      },
      {
        type: "category",
        inverse: true,
        data: results.map((result) => result.name),
        axisLabel: { interval: 0, width: nameWidth - 12, overflow: "truncate" },
      },
      // Stacks retain absolute percentile endpoints; the axis clips the part below the stage minimum.
      stackedSeries(results, colors, bars, gridIndex, points.length, "right"),
    );
    bars.forEach((bar, index) => {
      if (bar?.total != null) return;
      layout.top = top + (index + 0.5) * rowHeight - 6;
      layout.text("N/A", { x: left + 8, color: MUTED_COLOR });
    });
    layout.top = top + height + 32;
  }
}
