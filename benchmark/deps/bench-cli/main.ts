import { Command } from "commander";
import process from "node:process";
import { spawn } from "node:child_process";
import { UserBenchConfig } from "../bench.ts";
import { startRunBenchItem } from "./run_in_process.ts";

type Options = Partial<UserBenchConfig> & {
  jsFile: string;
  series: string[];
};
const RUN_IN_PROCESS = process.env["RUN_IN_PROCESS"];
if (RUN_IN_PROCESS) {
  // 基准测试进程
  await startRunBenchItem(RUN_IN_PROCESS);
} else {
  // 主进程逻辑
  const values = new Command()
    .parse(process.argv, { from: "user" })
    .opts<Options>();

  await runByProcess(values);
}
function integer(minimum: number) {
  return (value: string) => {
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) {
      throw new Error(`Expected a integer >= ${minimum}, received ${JSON.stringify(value)}`);
    }
    return number;
  };
}
async function runByProcess(cliOptions: Options) {
  const { jsFile, series, ...restOptions } = cliOptions;
  for (const s of series) {
    console.log(`\nRunning series: ${s}`);
    await runBenchItemUseProcess(jsFile, JSON.stringify({ ...restOptions, series: s }));
    console.log(`Finished series: ${s}`);
  }
}
async function runBenchItemUseProcess(jsFile: string, optionsJsonText: string) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [import.meta.url, jsFile, optionsJsonText], {
      stdio: "inherit",
      env: { ...process.env, RUN_IN_PROCESS: "1" },
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error(`Process exited with code ${code}`));
      }
    });
  });
}
