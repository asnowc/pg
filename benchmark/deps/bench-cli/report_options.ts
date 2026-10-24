import { type Command, Option } from "commander";
import {
  type IntervalMetric,
  type LatencyField,
  SVG_PRESETS,
  type SvgReportOptions,
  type SvgSection,
} from "../bench.ts";
import { jsonObject, list } from "./cli_args.ts";

/** 命令行中与 SVG 显示相关的选项，名称在生成报告时由 resolveSvgReportOptions 校验。 */
export type SvgReportCliOptions = {
  preset?: SvgReportOptions["preset"];
  sections?: string[];
  metrics?: string[];
  rankings?: boolean;
  latencyColumns?: string[];
  latencySort?: string;
  distribution?: string[];
  labels?: Record<string, unknown>;
};

export function addSvgReportOptions(command: Command): Command {
  return command
    .addOption(new Option("-p, --preset <name>", "SVG report preset").choices(SVG_PRESETS))
    .option(
      "--sections <list>",
      "comma separated sections: environment,summary,throughput,distribution,latency,timeline,notes",
      list,
    )
    .option("--metrics <list>", "timeline metrics: inFlight,ops,cpu,rss,memoryExtended,arrayBuffers,jsHeap", list)
    .option("--rankings", "show per-stage rankings below throughput and timeline charts")
    .option("--no-rankings", "hide per-stage rankings")
    .option("--latency-columns <list>", "latency table columns: min,p50,p75,p90,p95,p99,p995,p999,max,mean,rme", list)
    .option("--latency-sort <field>", "latency table sort field (high → low), default mean")
    .option("--distribution <list>", "percentile points of the latency distribution chart", list)
    .option(
      "--labels <json>",
      'report terms, e.g. {"series":"Library","operations":"queries","throughput":"QPS"}',
      jsonObject,
    );
}

export function toSvgReportOptions(options: SvgReportCliOptions): SvgReportOptions {
  const report: SvgReportOptions = {
    preset: options.preset,
    sections: options.sections as SvgSection[] | undefined,
    metrics: options.metrics as IntervalMetric[] | undefined,
    rankings: options.rankings,
    latencyColumns: options.latencyColumns as LatencyField[] | undefined,
    latencySortBy: options.latencySort as LatencyField | undefined,
    distribution: options.distribution as LatencyField[] | undefined,
    labels: options.labels as SvgReportOptions["labels"],
  };
  return Object.fromEntries(Object.entries(report).filter(([, value]) => value !== undefined));
}
