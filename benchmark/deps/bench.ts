export * from "./bench/ConcurrencyBench.ts";
export * from "./bench/types/bench_result.ts";
export * from "./bench/analyzer/sample_group.ts";
export * from "./bench/reporter/SvgReporter.ts";
export * from "./bench/collector/BenchCollector.ts";
export * from "./bench/collector/SampleCollector.ts";
export * from "./bench/run.ts";
export * from "./bench/reporter/FileDataReporter.ts";
declare global {
  var gc: undefined | (() => void);
}
