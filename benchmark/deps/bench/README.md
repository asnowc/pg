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
- 同进程运行（`runUserBench`）且运行时暴露了 gc（Deno：`--v8-flags=--expose-gc`；Node：`--expose-gc`）时，
  每个系列在初始化之后、测量之前执行一次 gc；未暴露时不执行。命令行的每个系列在新进程中运行，无需手动 gc。
  运行日志的头部会显示 gc 策略，是否执行了 gc 也会记录到结果清单与报告的环境信息。

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
| `--no-report`              | 只保存结果，不生成 SVG                       |

另支持下文的 [SVG 显示选项](#svg-显示选项)，与 `BENCH_CONFIG.report` 合并。

- 每个系列在新进程中运行，系列之间互不影响，不需要手动 gc。
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
- SVG 渲染只计算所选区块需要的资源摘要和分档 CPU 统计；可用 `--sections` 选择需要的内容。
- 选项名称无效时输出错误并以非零状态码退出。

### SVG 显示选项

| 选项                           | 说明                                                                                |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `-p, --preset <name>`          | `default`、`compact`、`throughput`、`latency`、`resource`                           |
| `--section, --sections <list>` | `environment,summary,throughput,latency,distribution,resource,cpu,memory,notes`     |
| `--metrics <list>`             | 可选曲线：`inFlight,ops,cpu,rss,memoryExtended,arrayBuffers,jsHeap`                 |
| `--rankings/--no-rankings`     | 是否在吞吐柱状图与内存曲线下方显示各并发档排行，不影响 CPU 柱状图                   |
| `--latency-columns <list>`     | 延迟明细列：`min,p50,p75,p90,p95,p99,p995,p999,max,mean,rme`                        |
| `--latency-sort <field>`       | 延迟明细的排序与倍数依据，默认 `mean`                                               |
| `--distribution <list>`        | 延迟分布图的百分位点，例如 `p50,p90,p99,p999`                                       |
| `--labels <json>`              | 覆盖报告术语，例如 `{"series":"Library","operations":"queries","throughput":"QPS"}` |

## SVG 报告

报告区块按以下顺序渲染，选项只决定是否显示：

| 区块           | 内容                                                                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `environment`  | 运行时、机器、测试参数、meta 与创建时间                                                                                                                                      |
| `summary`      | 整个测量窗口的汇总：操作数、错误数、错误率、ops/s、mean/p50/p99                                                                                                              |
| `throughput`   | 各并发档 ops/s 分组柱状图，以及 `metrics` 选择的 inFlight/ops 时间曲线                                                                                                       |
| `latency`      | 各并发档延迟明细；RME 为 95% 均值置信区间的相对半宽                                                                                                                          |
| `distribution` | 各 stage 纵向紧凑排列，每系列一根水平延迟增量堆叠条；横轴为延迟（ms），起点为该 stage 所有系列的最小请求延迟，条末为最高选定值                                               |
| `resource`     | 资源摘要：每请求 User/System/Total CPU（µs），正式测量窗口内时间加权平均 JS Heap、External、ArrayBuffer（MiB）；每请求平均 Total CPU 和平均 RSS 两张柱状图左右并排           |
| `cpu`          | `metrics` 包含 cpu 时分别显示 User/System/Total CPU 时间差（ms）和 CPU 使用率四张阶梯图；随后各 stage 一张每请求 CPU 堆叠柱状图，每系列一根 User/System 堆叠柱，柱顶为 Total |
| `memory`       | `metrics` 选择的 rss/memoryExtended/arrayBuffers/jsHeap 快照折线图及可选 stage 排行                                                                                          |
| `notes`        | 附注与统计口径                                                                                                                                                               |

- CPU、内存及吞吐/在途时间图的横轴保留运行经过时间，以预热结束为起点，虚线标记 stage 边界。
  延迟分布图的横轴则表示请求耗时。CPU 的不同指标各占一张图，颜色区分系列。
- 在途数与内存为快照时刻的瞬时值；吞吐曲线为区间完成成功操作数除以区间时长。
- CPU 的 stage 小图按输入顺序横向排列，空间不足时换行，同组 stage 使用相同纵轴范围。 延迟的 stage
  按输入顺序纵向紧凑排列，每系列一行，横轴范围由各 stage 的数据决定。
- 堆叠柱按系列着色，同色系深浅区分增量段，白色描边突出分段边界； CPU 的两段为
  User/System，延迟的各段为相邻选定统计值的增量。
- Deno 的 `arrayBuffers` 恒为 0（计入 external）；全部系列均报告 0 时省略该曲线，资源摘要显示 N/A，并在附注中说明。
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

| 预设         | 内容                                                                                |
| ------------ | ----------------------------------------------------------------------------------- |
| `default`    | 全部区块、全部资源曲线与全部延迟列（未指定预设时使用）                              |
| `compact`    | 环境、汇总、吞吐柱状图与延迟增量堆叠图，适合放入文档或 PR                           |
| `throughput` | 环境、汇总、吞吐柱状图与在途数/吞吐曲线                                             |
| `latency`    | 环境、汇总、延迟增量堆叠图与完整延迟明细（按 p99 排序）                             |
| `resource`   | 环境、资源摘要与并排 CPU/RSS 柱状图、四张 CPU 阶梯图、各 stage CPU 堆叠图及内存曲线 |

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

| 文件                   | 内容                                                                             |
| ---------------------- | -------------------------------------------------------------------------------- |
| `manifest.json`        | 测试名称、参数、meta、运行环境，以及已成功生成结果的系列                         |
| `<series>.sample.bin`  | 成功操作的样本（二进制，默认微秒精度）                                           |
| `<series>.result.json` | 档位起止时间、成功/失败总数与 CPU/内存快照（列式：每个字段一个按时间排列的数组） |
| `<series>.report.json` | 生成报告时缓存的分析结果，可删除后重新生成                                       |
| `report.svg`           | 所有系列的对比报告                                                               |

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

## 数据采样与计算

### 测量阶段与原始样本

- 正式测量窗口为 `run.startTime` 到 `run.endTime`；各 stage 从其开始时间持续到下一 stage 开始或正式测量结束。
  时长使用实际时间差，不直接用配置时长。`clearTime` 为最终排空结束时间，不计入正式窗口时长。
- 预热结束和 stage 切换时不排空、不重建资源。降低目标并发时，已有操作继续执行，实际在途数可能暂时高于目标并发。
  最后一档结束后目标并发设为 0，等待在途请求完成；被测调用一直不结束时，基准也不会结束。
- 一次操作的样本是 `performance.now()` 的 `[startTime, endTime]`，单位毫秒；默认以微秒精度向下取整后落盘。
  预热发起的操作不保存为正式样本。`warmup.iterations` 记录预热期间发起次数，不是完成次数。
- 正式操作按发起时间归入 stage，跨 stage 或排空期间完成仍归原发起 stage。 吞吐柱状图与延迟统计使用此归组；CPU
  每请求分母则使用同窗口的快照完成计数，二者不一定相同。
- 时间图从预热结束开始展示，横轴使用相对预热开始的经过秒数；虚线表示 stage 边界，不展示预热或排空阶段。

### CPU、内存与调度快照

- 按 `intervalSample` 定时采集 `process.cpuUsage()` 的累计 User/System CPU 时间（微秒）、 `process.memoryUsage()`
  的进程内存（字节），以及在途数、发起计数和成功/失败完成计数。
  资源数据是整个基准进程的消耗，不是单独测量数据库服务端或某一请求。
- 快照覆盖预热、正式测量和最终排空；每个 stage 开始（并发调整之后）、停止补发和排空结束时补采快照。 定时器不随 stage
  边界重新对齐，实际区间可能长短不一，不能把每个快照都视作等时长。
- 在途数曲线读取快照时刻的实际在途操作数，而不是目标并发。内存曲线同样展示快照瞬时值，统一从字节换算为 MiB：
  `MiB = bytes / 1024²`。

### 请求数、错误与吞吐

- summary 的成功数来自正式成功样本，失败数取运行记录的失败总数与正式失败样本数中的较大值；
  操作总数为成功数加失败数，错误率为 `失败数 / 操作总数 × 100%`，无操作时为 N/A。
- summary 吞吐为 `正式成功样本数 / 正式窗口秒数`；stage 吞吐柱为 `该 stage 发起的成功操作数 / stage 秒数`，
  包含这些操作在后续 stage 或排空期间的完成结果。
- 吞吐时间曲线按成功样本的完成时间计入快照区间，值为 `区间内成功完成样本数 / 区间秒数`。
  区间采用左闭右开，恰好在边界完成的样本进入下一区间。
- 当前命令行和 `runUserBench` 文件流程只保存成功样本，stage 失败样本数为 0；
  失败仍体现在运行总数及资源快照的失败完成计数中。

### 延迟、百分位与堆叠分布

- 只统计成功操作，单次延迟为 `endTime - startTime`（ms）；min/max 为最小/最大值，mean 为算术平均。
  将延迟升序排列后，百分位 `p` 取第 `ceil(n × p)` 个样本，即最近秩法，不插值；无成功样本时为 N/A。
- RME 为均值的 95% Student-t 置信区间相对半宽： `RME = t(0.975, n−1) × s / sqrt(n) / mean × 100%`，`s` 为样本标准差。
  不足两个样本或均值为零时为 N/A。
- 延迟分布图每 stage 一张水平条形图，每系列一行。`distribution` 选择的有效统计值按值升序构造增量段：例如选择
  p50/p90/p99/max 时，各段为 `p50`、`p90−p50`、`p99−p90`、`max−p99`。
  各段不是请求数或概率，也不是可直接相加的原始百分位值。
- 横轴表示请求延迟（ms），原点为该 stage 所有系列的实际最小请求延迟（min），不取最小的选定百分位，也不标为 0。
  各段保留绝对百分位端点，低于该起点的部分裁去；条末坐标和标签为最高选定值， 未选择 max
  时不代表最大请求延迟。支持乱序选择、重复点位和 mean/min/max：先去重，再按每系列的实际值排序，相同值的增量为零。
  图中深浅对应所选点位的说明顺序，不代表所有系列中统计值的排序一定相同。
- 水平堆叠图使用线性横轴，不使用对数轴；stage 纵向排列，绘图区高度按系列行数计算，避免固定高度造成空白。

### 每请求 CPU 与 CPU 时间图

- 对正式窗口或某个 stage，取快照累计 CPU 时间增量及完成请求数： `N = ΔsuccessCount + ΔerrorCount`。
  `User CPU/request = Δuser / N`，`System CPU/request = Δsystem / N`， `Total CPU/request = (Δuser + Δsystem) / N`，单位
  µs/request。
- 完成计数包含失败请求，以及预热期间发起但在正式窗口内完成的请求；不包含测量窗口外和排空阶段的完成数。
  这是整个窗口的进程 CPU 消耗均摊，不是逐个请求独立计时。
- User CPU、System CPU、Total CPU 分别使用独立阶梯图，展示相邻快照的 CPU 时间差，换算为 ms， 而非从进程启动累计的 CPU
  时间。边界附近采样间隔较短时，区间 CPU 耗时也可能较小。
- 第四张阶梯图显示 CPU 使用率：`CPU utilization = 区间 Total CPU 时间 / 区间墙钟时间 × 100%`， 以一个逻辑核心为
  100%，可能超过 100%。各图对比全部系列，`--metrics cpu` 同时控制这四张阶梯图。
- 每 stage 的 CPU 柱状图按系列显示 User/System 两段堆叠，柱顶标注两者之和 Total。

### 内存均值与统计窗口

- **Resource consumption summary 的 JS heap、External、ArrayBuffer，以及 Average process RSS，
  都只统计正式测量窗口，不计预热和排空阶段。** 不按请求数平均，也不扣除预热结束时的内存基线。
- JS heap 使用 `heapUsed`，External 使用 `external`，ArrayBuffer 使用 `arrayBuffers`，RSS 使用 `rss`。 External 包含
  ArrayBuffer，不能把二者简单相加当作总内存。
- 区间内使用右端快照的内存值。设采样区间与统计窗口的重叠时长为 `wᵢ`， 则
  `平均内存 = Σ(右端快照内存 × wᵢ) / Σwᵢ`，最后换算为 MiB。stage 内存排行采用同样的时间加权方式。
- 无采样覆盖时内存均值为 N/A；完成请求数为零不会使有有效采样覆盖的内存均值失效。 Deno 的 `arrayBuffers` 恒为 0（计入
  external）；全部系列均报告 0 时摘要显示 N/A，并省略该内存曲线。

### 窗口边界、缺失数据与排行

- CPU 时间和完成计数的增量按采样区间与统计窗口的重叠比例分配；窗口外的完整区间不参与计算。
  内存以右端快照代表区间值。边界值是采样近似，不是对窗口内每一时刻的精确测量。
- 无采样覆盖或窗口内完成数为零时，每请求 CPU 为 N/A；无有效延迟样本时不绘制虚假的零延迟柱。
- 表格与排行按数值从高到低排序，缺失值置后；`vs lowest = 当前值 / 同表最低值`。 最低值为 0 时，零值本身的倍数为
  1，非零值的倍数为 N/A。 排序方向不等于优劣方向，需结合标题中的 higher/lower is better。

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
