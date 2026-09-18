import path from "node:path";
import fs from "node:fs/promises";
import { BenchCollector, genResultSvgFromResultDir, REPORT_SVG_NAME, resolveSvgReportOptions } from "../bench.ts";
import { type SvgReportCliOptions, toSvgReportOptions } from "./report_options.ts";

export type ReportOptions = SvgReportCliOptions & { force?: boolean; output?: string };

/**
 * 为单个结果目录生成 SVG 报告。未指定任何显示选项且报告已存在时跳过；
 * 指定显示选项时复用缓存的分析结果重新渲染；force 时重新分析并覆盖。
 */
export async function reportCommand(dir: string, options: ReportOptions) {
  const resultDir = path.resolve(dir);
  const report = toSvgReportOptions(options);
  resolveSvgReportOptions(report);
  const manifest = await new BenchCollector(resultDir).readManifest();
  if (!manifest?.series.length) throw new Error(`No benchmark results found in ${resultDir}`);

  const svgPath = path.resolve(resultDir, options.output ?? REPORT_SVG_NAME);
  const customized = Object.keys(report).length > 0;
  if (!options.force && !customized && await fs.access(svgPath).then(() => true, () => false)) {
    console.log(`skip      ${svgPath} (exists, use --force or display options to regenerate)`);
    return;
  }
  const start = performance.now();
  await genResultSvgFromResultDir(resultDir, { force: options.force, output: svgPath, report });
  console.log(`generated ${svgPath} (${Math.round(performance.now() - start)}ms)`);
}
