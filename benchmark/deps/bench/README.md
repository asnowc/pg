# bench

面向异步调用的并发基准工具：按并发档位持续发起操作，记录每个操作的起止时间与进程 CPU/内存快照，
将结果保存到结果目录，并生成可对比多个系列的 SVG 报告。

- 被测对象是任意返回 Promise 的函数，工具本身不关心调用内容。
- 执行器只依赖 Promise、定时器和 `node:process`，可在 Deno 或支持 TypeScript 的 Node 工具链中运行。
- SVG 报告使用 ECharts 服务端渲染，依赖 `echarts`；命令行依赖 `commander`。

## 核心概念

| 名称     | 含义                                                                             |
| -------- | -------------------------------------------------------------------------------- |
| 系列     | 一个被比较的实现，例如不同的库或配置。每个系列独立运行，结果保存为独立文件。     |
| 操作     | 对被测函数的一次调用；吞吐以每秒成功操作数（ops/s）表示。                        |
| 并发档位 | 目标并发数及其持续时间。多个档位按输入顺序依次执行，档位之间不排空。             |
| 预热     | 仅使用第一档并发，预热发起的操作不计入样本。                                     |
| 样本     | `[startTime, endTime]`，来自 `performance.now()`，单位毫秒；成功与失败分别收集。 |
| 快照     | 按采样间隔记录的累计 CPU 时间、内存占用与调度计数，用于绘制资源曲线。            |
| 结果目录 | 一次基准测试的输出目录，包含清单、各系列样本与结果、分析缓存和 SVG 报告。        |

## 编写基准测试文件

基准测试文件导出被测项工厂与配置，可由命令行运行，也可在文件内直接调用 `runUserBench`：

```ts
import { type GetBenchItem, runUserBench, type UserBenchConfig } from "./bench.ts";

export const BENCH_CONFIG: UserBenchConfig = {
  benchName: "timer example",
  concurrency: [10, 50, 100], // 每档目标并发
  duration: 2000, // 每档测量时长（ms）
  warmupDuration: 100, // 预热时长（ms）
  intervalSample: 500, // CPU/内存采样间隔（ms）
  benchDataDir: `./results/timer-${Date.now()}`,
  report: { preset: "compact" }, // 可选：SVG 显示选项
};
export const SERIES = ["timer-1ms", "timer-2ms"];
export const META = { delayScale: 1 };

/** 为一个系列创建被测函数及其释放函数。 */
const getBenchItem: GetBenchItem<typeof META> = async (series, meta) => {
  const delay = (series === "timer-1ms" ? 1 : 2) * meta.delayScale;
  return {
    fn: () => new Promise<void>((resolve) => setTimeout(resolve, delay)),
    close: async () => {},
  };
};
export default getBenchItem;

if (import.meta.main) {
  await runUserBench(BENCH_CONFIG, { series: SERIES, meta: META, getBenchItem });
}
```

- `fn` 在正式测量前会以索引 `-1` 调用一次作为可用性检查；之后的调用索引从 `0` 递增。
- `close` 在系列结束后调用，负责释放连接、连接池等资源；测量失败时也会调用。
- `META` 会记录到清单并传给 `getBenchItem`，用于描述影响结果的业务参数。
- `runUserBench` 在当前进程中依次运行所有系列；需要隔离 JIT、GC 与资源占用时使用命令行，每个系列运行在独立子进程中。

## 命令行

命令行入口为 [bench-cli](../bench-cli/main.ts)，下文以 `bench-cli` 代指 `deno run -A <path>/bench-cli/main.ts`。

### run：运行基准测试

```sh
# 使用文件内配置运行全部系列，结束后生成 report.svg
bench-cli run my.bench.ts
# 覆盖系列、并发档位、每档时长、预热与输出目录
bench-cli run my.bench.ts -s timer-1ms -c 100,250 -d 2000 -w 100 -o results/tmp
```

| 选项                       | 说明                                         |
| -------------------------- | -------------------------------------------- |
| `-s, --series <names>`     | 逗号分隔的系列，默认取文件导出的 `SERIES`    |
| `-o, --out <dir>`          | 输出目录，默认取 `BENCH_CONFIG.benchDataDir` |
| `-c, --concurrency <list>` | 逗号分隔的并发档位                           |
| `-d, --duration <ms>`      | 每档测量时长                                 |
| `-w, --warmup <ms>`        | 预热时长                                     |
| `-i, --interval <ms>`      | CPU/内存采样间隔                             |
| `-m, --meta <json>`        | 合并到 `META` 的 JSON 对象                   |
| `--gc`                     | 暴露 GC，并在每个系列开始前执行一次          |
| `--no-report`              | 只保存结果，不生成 SVG                       |

另支持下文的 [SVG 显示选项](#svg-显示选项)，与 `BENCH_CONFIG.report` 合并。

- 输出目录中已有同名系列的结果时拒绝运行，避免覆盖。
- 同一结果目录可分多次追加不同系列，但测试名称、参数或 meta 不一致时拒绝运行，保证结果可比。
- 单个系列失败只记录在汇总表中，不会中断其余系列；清单只登记成功的系列。
- 运行日志按系列输出 setup、预热、每档成功数/失败数/ops/s、排空和 teardown
  耗时，失败操作只打印第一个错误，结束时输出汇总表。

### report：为结果目录生成报告

```sh
bench-cli report results/my-bench
# 重新分析样本并覆盖
bench-cli report results/my-bench --force
# 使用预设并输出到另一个文件（相对结果目录）
bench-cli report results/my-bench -p compact -o report.compact.svg
# 自定义区块与列
bench-cli report results/my-bench --sections summary,latency --latency-columns p50,p99 --latency-sort p99
```

- 已有报告且未指定任何显示选项时跳过。
- 指定显示选项时复用缓存的分析结果重新渲染；`-f, --force` 会重新分析样本。
- 选项名称无效时输出错误并以非零状态码退出。

### SVG 显示选项

| 选项                       | 说明                                                                                |
| -------------------------- | ----------------------------------------------------------------------------------- |
| `-p, --preset <name>`      | `default`、`compact`、`throughput`、`latency`、`resource`                           |
| `--sections <list>`        | `environment,summary,throughput,distribution,latency,timeline,notes`                |
| `--metrics <list>`         | 资源曲线：`inFlight,ops,cpu,rss,memoryExtended,jsHeap`                              |
| `--rankings/--no-rankings` | 是否在吞吐柱状图与资源曲线下方显示各并发档排行                                      |
| `--latency-columns <list>` | 延迟明细列：`min,p50,p75,p90,p95,p99,p995,p999,max,mean,rme`                        |
| `--latency-sort <field>`   | 延迟明细的排序与倍数依据，默认 `mean`                                               |
| `--distribution <list>`    | 延迟分布图的百分位点，例如 `p50,p90,p99,p999`                                       |
| `--labels <json>`          | 覆盖报告术语，例如 `{"series":"Library","operations":"queries","throughput":"QPS"}` |

## SVG 报告

报告区块按以下顺序渲染，选项只决定是否显示：

| 区块           | 内容                                                                                                                                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`  | 运行时、机器、测试参数、meta 与创建时间                                                                                                                                                                                         |
| `summary`      | 整个测量窗口的汇总：操作数、错误数、错误率、ops/s、mean/p50/p99、CPU 均值、RSS 峰值                                                                                                                                             |
| `throughput`   | 各并发档 ops/s 分组柱状图                                                                                                                                                                                                       |
| `distribution` | 各并发档延迟百分位曲线；数值跨度达到 20 倍时使用对数纵轴                                                                                                                                                                        |
| `latency`      | 各并发档延迟明细；RME 为 95% 均值置信区间的相对半宽                                                                                                                                                                             |
| `timeline`     | `metrics` 指定的资源时间曲线；时间从预热开始计时，横轴起点为预热时长，虚线标记档位边界。ops/s 与 CPU 为区间平均值，以阶梯线覆盖各采样区间；在途数与内存为快照时刻的瞬时值，以阶梯线保持到下一个快照，从正式测量开始时的快照画起 |
| `notes`        | 附注与统计口径                                                                                                                                                                                                                  |

- 所有排行与表格统一按数值从高到低排序，`vs lowest` 为该值相对同表最低值的倍数。
- 每个指标在标题右侧标注越高越好还是越低越好，阅读倍数时需结合该提示。
- 报告默认使用通用术语 Series / operation / ops / ops/s。可通过 `labels` 换成贴合被测对象的说法，不受预设影响：

  | 字段         | 默认值      | 用途                     |
  | ------------ | ----------- | ------------------------ |
  | `series`     | `Series`    | 表格中被比较对象的列名   |
  | `operation`  | `operation` | 单数，例如延迟表标题     |
  | `operations` | `ops`       | 复数或缩写，例如操作数列 |
  | `throughput` | `ops/s`     | 吞吐单位                 |

预设：

| 预设         | 内容                                                   |
| ------------ | ------------------------------------------------------ |
| `default`    | 全部区块、全部资源曲线与全部延迟列（未指定预设时使用） |
| `compact`    | 环境、汇总、吞吐柱状图与延迟分布，适合放入文档或 PR    |
| `throughput` | 环境、汇总、吞吐柱状图与在途数/吞吐曲线                |
| `latency`    | 环境、汇总、延迟分布与完整延迟明细（按 p99 排序）      |
| `resource`   | 环境与 CPU/RSS/扩展内存/JS 堆曲线                      |

在代码中使用时，显式选项覆盖预设：

```ts
import { genResultSvgFromResultDir, renderSvg } from "./bench.ts";

await genResultSvgFromResultDir("results/my-bench", {
  output: "report.latency.svg",
  report: { preset: "latency", distribution: ["p50", "p99", "p999"], labels: { operations: "queries" } },
});

// 已有分析结果时，也可以直接渲染
await renderSvg({ path: "summary.svg", results, sections: ["summary", "throughput"] });
```

## 结果目录

| 文件                   | 内容                                                                   |
| ---------------------- | ---------------------------------------------------------------------- |
| `manifest.json`        | 测试名称、参数、meta、运行环境，以及已成功生成结果的系列               |
| `<series>.sample.bin`  | 成功操作的样本（二进制，默认微秒精度）                                 |
| `<series>.result.json` | 档位起止时间、成功/失败总数与 CPU/内存快照                             |
| `<series>.report.json` | 生成报告时缓存的分析结果，可删除后重新生成；旧结构的缓存会自动重新分析 |
| `report.svg`           | 所有系列的对比报告                                                     |

`<series>` 为系列名中的空白、`/`、`\`、`:` 替换为 `_` 后的文件名。

## 底层 API

除上述流程外，各环节也可单独使用：

- `ConcurrencyBench`：并发执行器。`runWidthCpuAndMemory({ fn, intervalSampleCPUAndMemory, collectorSuccess, collectorFailed, onProgress? })`
  返回档位、计数与快照；收集器只需提供同步的 `push(sample)`，数组也可以。 成功与失败样本本身没有标志，应分别收集。
- `openFileCollector(path)` / `writeFileSamples` / `readFileSamples` /
  `iterateFileSamples`：以二进制格式流式写入和读取样本。 文件收集器必须 `await close()` 或使用
  `await using`，否则末尾样本可能丢失。
- `BenchCollector`：读写结果目录中的清单、样本与结果。
- `analyzeSampleGroup({ run, successSamples, failedSamples })`：按操作发起时间所在档位归组延迟，
  并计算正式测量窗口内的资源曲线与档位平均值。
- `renderSvg` / `genResultSvgFromResultDir`：生成 SVG 报告。

```ts
import { ConcurrencyBench, type ConcurrencyBenchSample } from "./bench.ts";

const success: ConcurrencyBenchSample[] = [];
const failed: ConcurrencyBenchSample[] = [];
const result = await new ConcurrencyBench({ concurrency: [1, 2, 1], duration: 200, warmupDuration: 50 })
  .runWidthCpuAndMemory({
    fn: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    intervalSampleCPUAndMemory: 50,
    collectorSuccess: success,
    collectorFailed: failed,
  });
console.log(result.stageSamples, success.length, failed.length);
```

## 测量口径

- 预热结束后不排空，直接开始正式测量；档位之间也不排空、不重建资源。
  降低目标并发时，已有操作继续执行，实际在途数可能暂时高于目标。
- 最后一档结束后将目标并发设为 `0`，等待所有在途调用完成后返回。`duration` 只限制补发窗口，
  不包含最终排空；被测调用一直不结束时，基准也不会结束。
- 样本按操作发起时间归入档位，跨档完成和排空期间完成的操作仍归原发起档。
- `warmup.iterations` 是预热期间发起的次数，不是已完成的次数。
- 快照覆盖预热、正式测量与排空；除定时采样外，预热结束、每档开始（并发调整之后）和停止补发时立即补采一次，
  使档位边界上的在途数立即反映新档位，资源区间不跨越档位。定时器不随之重新对齐，边界附近的区间会短于采样间隔。
  报告中的资源曲线与档位平均值不包含排空。
- CPU 以单个逻辑核心的百分比表示，可能超过 100%。

## 限制

- 失败的调用只计入失败结果，执行器仍按目标并发补发，没有失败次数上限，也不校验调用结果的内容。
- 通过 `runUserBench` 或命令行运行时只保存成功样本；失败只体现在总数中，报告中的分档失败数为 0。
- 收集器抛出异常时仅记录日志并将目标并发设为 `0`，不会使返回的 Promise 拒绝；排空期间发生时，等待可能无法完成。
- 被测函数持续返回立即兑现或拒绝的 Promise 时，补发形成的微任务链可能阻塞档位与采样计时器。
- 调用方负责释放被测资源，以及文件收集器的最终刷新和关闭。

## 类型检查

在本目录的上一级目录执行：

```sh
deno check bench.ts bench-cli/main.ts
```
