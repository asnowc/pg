import path from "node:path";
import { BenchCollector } from "../collector/BenchCollector.ts";
import { AnalyzedSampleGroup, analyzeSampleGroup } from "../analyzer/sample_group.ts";
import { renderSvg } from "./SvgReporter.ts";
import fs from "node:fs/promises";

export async function genResultSvgFromResultDir(dir: string, names: string[]) {
  const collector = new BenchCollector(dir);
  const group: AnalyzedSampleGroup[] = [];
  for (const name of names) {
    const analysisFilePath = path.join(dir, `${BenchCollector.replaceName(name)}.report.json`);
    const exists = await fs.access(analysisFilePath).then(() => true, () => false);
    if (exists) {
      const analysis = JSON.parse(await fs.readFile(analysisFilePath, "utf-8"));
      group.push(analysis);
    } else {
      const { metadata, result, schemaVersion } = await collector.getBenchResult(name);
      const samples = await collector.readSampleFile(name);
      const analysis = analyzeSampleGroup({
        successSamples: samples,
        failedSamples: [],
        run: result,
        name,
      });
      await fs.writeFile(analysisFilePath, JSON.stringify(analysis));
      group.push(analysis);
    }
  }
  const svgPath = path.join(dir, `report.svg`);
  await renderSvg({ path: svgPath, results: group });
  return svgPath;
}
