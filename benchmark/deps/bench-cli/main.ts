import { Command } from "commander";
import process from "node:process";
import { REPORT_SVG_NAME } from "../bench.ts";
import { integer, integerList, jsonObject, list } from "./cli_args.ts";
import { runCommand, type RunOptions } from "./run_command.ts";
import { reportCommand, type ReportOptions } from "./report_command.ts";
import { addSvgReportOptions } from "./report_options.ts";

/*
  基准测试命令行入口，不导出任何成员。每个系列在独立子进程中运行，避免不同客户端库之间的 JIT、GC 和资源相互干扰。

  run <file>      运行基准测试文件，结束后生成 SVG 报告；每个系列在新进程中运行，无需手动 gc
  report <dir>    为结果目录生成 SVG 报告；已有报告且未指定显示选项时跳过，--force 重新分析
  两个命令都支持 --preset/--sections/--metrics 等 SVG 显示选项
*/

function createCli(): Command {
  const program = new Command("bench-cli")
    .description("Run concurrency benchmarks and generate SVG reports.")
    .showHelpAfterError();

  addSvgReportOptions(
    program.command("run")
      .description("Run a benchmark file; each series runs in its own child process.")
      .argument("<file>", "benchmark module exporting default getBenchItem, BENCH_CONFIG and SERIES")
      .option("-s, --series <names>", "comma separated series (default: SERIES of the module)", list)
      .option("-o, --out <dir>", "output directory (default: BENCH_CONFIG.benchDataDir)")
      .option("-c, --concurrency <list>", "comma separated concurrency stages", integerList(1))
      .option("-d, --duration <ms>", "duration of each concurrency stage", integer(1))
      .option("-w, --warmup <ms>", "warmup duration", integer(0))
      .option("-i, --interval <ms>", "CPU/memory sampling interval", integer(1))
      .option("-m, --meta <json>", "JSON merged into the module META", jsonObject)
      .option("--no-report", "skip SVG report generation"),
  ).action(async (file: string, options: RunOptions) => {
    if (!await runCommand(file, options)) process.exitCode = 1;
  });

  addSvgReportOptions(
    program.command("report")
      .description(`Generate ${REPORT_SVG_NAME} for a result directory.`)
      .argument("<dir>", "benchmark output directory")
      .option("-o, --output <file>", `SVG output path relative to <dir> (default: ${REPORT_SVG_NAME})`)
      .option("-f, --force", "re-analyze samples and overwrite the report even if it already exists"),
  ).action((dir: string, options: ReportOptions) => reportCommand(dir, options));

  return program;
}

await createCli().parseAsync(process.argv).catch((error: unknown) => {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
