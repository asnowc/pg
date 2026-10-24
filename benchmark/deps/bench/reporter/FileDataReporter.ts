import path from "node:path";
import fs from "node:fs/promises";
import { BenchCollector } from "../collector/BenchCollector.ts";
import { type AnalyzedSampleGroup, analyzeSampleGroup } from "../analyzer/sample_group.ts";
import { renderSvg, type SvgReportOptions } from "./SvgReporter.ts";

export const REPORT_SVG_NAME = "report.svg";

export type GenSvgOptions = {
  /** 忽略已缓存的 `.report.json` 分析结果并重新分析，默认 false。 */
  force?: boolean;
  /** SVG 输出路径，默认结果目录下的 `report.svg`。 */
  output?: string;
  /** 控制显示的区块与信息，可使用预设。 */
  report?: SvgReportOptions;
};

/**
 * 根据结果目录清单中登记的系列生成 SVG 报告（默认 `report.svg`），并返回其路径。
 * 每个系列的分析结果缓存到 `<series>.report.json`。目录没有清单、清单中没有系列或报告选项无效时抛出。
 */
export async function genResultSvgFromResultDir(dir: string, options: GenSvgOptions = {}): Promise<string> {
  const collector = new BenchCollector(dir);
  const manifest = await collector.readManifest();
  if (!manifest) throw new Error(`No benchmark manifest found in ${dir}`);
  if (!manifest.series.length) throw new Error(`No completed series in ${dir}`);

  const group: AnalyzedSampleGroup[] = [];
  for (const name of manifest.series) {
    const analysisFilePath = path.join(dir, `${BenchCollector.replaceName(name)}.report.json`);
    const cached = options.force ? undefined : await readAnalysisCache(analysisFilePath);
    if (cached) {
      group.push(cached);
      continue;
    }
    const { result } = await collector.getBenchResult(name);
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
  const svgPath = path.resolve(dir, options.output ?? REPORT_SVG_NAME);
  await renderSvg({ ...options.report, path: svgPath, results: group, title: manifest.benchName, manifest });
  return svgPath;
}
export function fileExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true, () => false);
}

/** 读取分析缓存；文件不存在时返回 undefined。 */
async function readAnalysisCache(filePath: string): Promise<AnalyzedSampleGroup | undefined> {
  if (!await fileExists(filePath)) return undefined;
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as AnalyzedSampleGroup;
}
