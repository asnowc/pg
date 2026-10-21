import { AnalyzeSampleGroupResult, IntervalSamples } from "../analyzer/sample_group.ts";

export async function renderSvg(input: {
  path: string;
  intervalSample: IntervalSamples;
  resultGroup: Map<string, AnalyzeSampleGroupResult>;
}) {
  const { path, intervalSample, resultGroup } = input;
  //TODO
  console.log("SVG output path:", path);
}
