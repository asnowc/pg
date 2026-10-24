/*
  bench-cli 子进程入口：运行主进程通过环境变量传入的单个系列。
  日志由主进程的系列标题统领，这里只输出系列内部过程。不导出任何成员。
*/
import { type GetBenchItem, runBenchItem } from "../bench.ts";
import { CHILD_TASK_ENV, ChildTask } from "./child_task.ts";

const task = readChildTask();
let getBenchItem: GetBenchItem<any> | undefined;
try {
  const mod = await import(task.file) as Partial<{ default?: GetBenchItem<any> }>;
  getBenchItem = mod.default;
} catch (error) {
  throw new Error(`Failed to import benchmark module: ${task.file}`, { cause: error });
}
if (!getBenchItem) {
  throw new Error(`Benchmark module does not export a default GetBenchItem function: ${task.file}`);
}
await runBenchItem(task.config, { series: task.series, meta: task.meta, getBenchItem });

function readChildTask(): ChildTask {
  const taskJson = process.env[CHILD_TASK_ENV];
  if (!taskJson) throw new Error(`Missing ${CHILD_TASK_ENV}`);
  return JSON.parse(taskJson) as ChildTask;
}
