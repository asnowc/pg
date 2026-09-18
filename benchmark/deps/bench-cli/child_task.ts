import type { UserBenchConfig } from "../bench.ts";

/** 主进程通过环境变量传给子进程的单系列任务。 */
export type ChildTask = {
  /** 基准测试模块 URL */
  file: string;
  series: string;
  /** 已与模块 BENCH_CONFIG 合并且 benchDataDir 为绝对路径 */
  config: UserBenchConfig;
  meta: Record<string, unknown>;
};
export const CHILD_TASK_ENV = "BENCH_CLI_CHILD_TASK";
