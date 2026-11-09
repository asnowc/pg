import type { AnalyzedSampleGroup } from "../../analyzer/sample_group.ts";
import { type ResourceWindow, resourceWindow } from "../../analyzer/resource_usage.ts";
import type { ReportLayout } from "./layout.ts";
import type { ResolvedSvgReportOptions } from "./options.ts";

export type RenderContext = {
  layout: ReportLayout;
  results: AnalyzedSampleGroup[];
  colors: string[];
  options: ResolvedSvgReportOptions;
  /** 时间轴从预热开始计时，正式测量开始于该秒数，即时间轴的起点。 */
  warmupSeconds: number;
  resources: ResourceWindow[];
  stageResources: ResourceWindow[][];
  stageConcurrencies: number[];
  arrayBuffersUnavailable: boolean;
};

export function createRenderContext(
  input: Omit<RenderContext, "resources" | "stageResources" | "stageConcurrencies">,
): RenderContext {
  const { results } = input;
  let resources: ResourceWindow[] | undefined;
  let stageResources: ResourceWindow[][] | undefined;
  const stageConcurrencies: number[] = [];
  for (const result of results) {
    result.stages.forEach((stage, index) => {
      stageConcurrencies[index] ??= stage.concurrency;
    });
  }
  return {
    ...input,
    stageConcurrencies,
    get resources() {
      return resources ??= results.map((result) => resourceWindow(result.run));
    },
    get stageResources() {
      return stageResources ??= results.map((result) =>
        result.stages.map((stage) =>
          resourceWindow(
            result.run,
            result.run.startTime + stage.startSeconds * 1000,
            result.run.startTime + stage.endSeconds * 1000,
          )
        )
      );
    },
  };
}
