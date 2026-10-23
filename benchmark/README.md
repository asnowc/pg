# 查询基准

## 工具与运行环境

当前并发执行器是 [ConcurrencyBench](deps/bench/ConcurrencyBench.ts)，汇总入口是
[deps/bench.ts](deps/bench.ts)。执行器使用 JavaScript Promise、定时器以及 `node:process` 的 CPU/内存接口， 不依赖 Deno
全局。可通过 Deno 或支持 TypeScript 的 Node 工具链运行。 现有文件收集、分析和 SVG
流程尚未全部适配新的成功/失败双收集器，不能直接视为完整可用的流水线。

连接配置来自 [db.ts](utils/db.ts)，默认 `postgres://postgres@127.0.0.1:5432/test_public`， 使用 `TEST_LOGIN_DB`
覆盖。当前比较明文 TCP，不读取 URL 中的 TLS 等查询参数。

## 当前并发工具 API

构造 `ConcurrencyBench` 时使用以下配置，所有时长均以毫秒计：

| 配置             | 含义                                                                         |
| ---------------- | ---------------------------------------------------------------------------- |
| `name`           | 结果名称，默认空字符串。                                                     |
| `concurrency`    | 正整数、正整数数组或 `{ value, duration }[]`，按输入顺序执行，保留重复档位。 |
| `duration`       | 数值档位的测量时长，默认 `3000`；对象档位使用自己的 `duration`。             |
| `warmupDuration` | 仅第一档的预热时长，默认 `0`。                                               |

`runWidthCpuAndMemory()` 接收被测 `fn`、采样间隔 `intervalSampleCPUAndMemory`， 以及分别接收成功和失败样本的
`collectorSuccess`、`collectorFailed`。 收集器只需要同步的 `push(sample): void`
方法，数组也可使用。两个收集器应分别保存数据， 否则三元组本身没有成功标志，合并后无法还原成功/失败归属。

下面是在仓库根目录运行的无数据库调度示例：

```ts
import { ConcurrencyBench } from "./benchmark/deps/bench/ConcurrencyBench.ts";
import type { ConcurrencyBenchSample } from "./benchmark/deps/bench/types/bench_result.ts";

const successSamples: ConcurrencyBenchSample[] = [];
const failedSamples: ConcurrencyBenchSample[] = [];
const result = await new ConcurrencyBench({
  name: "timer-example",
  concurrency: [1, 2, 1],
  duration: 200,
  warmupDuration: 50,
}).runWidthCpuAndMemory({
  fn: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
  intervalSampleCPUAndMemory: 50,
  collectorSuccess: successSamples,
  collectorFailed: failedSamples,
});
console.log(result, successSamples.length, failedSamples.length);
```

### 阶段、样本和资源采样

- 预热结束后不排空，直接开始正式测量；正式档位之间也不排空、不重建连接。
  降低目标并发时，已有请求继续执行，实际在途数可能暂时高于目标。
- 最后一档计时结束后将目标并发设为 `0`，正常情况下等待所有在途调用完成后返回。 `duration`
  限制补发窗口，不包含最终排空；被测调用若一直不结束，基准也不会结束。
- 样本为 `[startTime, endTime]`，时间来自 `performance.now()`，单位为毫秒。
  预热发起的请求即使在正式阶段完成，也不会传给收集器。
  成功和失败结果分别进入对应收集器；失败样本不包含原始异常。
- 返回值的 `warmup.iterations` 是预热期间发起的次数，不是预热结束时已完成的次数。 `warmup.duration`
  是预热的实际耗时，不包含单独的排空阶段。
- `stageSamples` 保存每档目标并发及开始时间，每档结束于下一档开始或 `endTime`。
  样本按发起时间归档；跨档完成和最终排空的结果仍归原发起档。
- `intervalSampleData` 按指定间隔采集累计 CPU 使用量、内存占用和单调时间戳，
  覆盖预热、正式测量及最终排空。采集开始、正式测量开始和每档结束时立即补采并重新对齐定时器，
  使每个资源区间都落在单一阶段内；与边界相距不足采样间隔 1/10 的定时快照会被边界快照替换。

### 错误与当前限制

- 查询失败只计入失败结果，仍按目标并发补发，不会直接使基准 Promise 拒绝。 当前配置没有
  `maxFailures`，也没有失败次数上限。工具不验证 SQL 返回行的内容。
- 收集器异常目前仅打印日志并将目标并发设为 `0`，不会作为基准 Promise 的拒绝原因；
  后续档位仍可能重新开始派发。异常发生在最终排空期间时，等待可能无法完成。
  不应把这种情况下的成功返回当作样本完整的证明。
- 若被测函数持续返回立即兑现或拒绝的 Promise，补发形成的微任务链可能阻塞阶段和资源采样计时器。
  当前实现没有保证这种场景的计时公平性。
- 调用方负责创建和释放数据库连接，以及文件收集器的最终刷新、关闭或异步释放。 执行器不代替调用方等待收集器的异步写入。

## 现有脚本与报告的迁移状态

[fixed-concurrency.bench.ts](test/fixed-concurrency.bench.ts) 仍使用旧的 `collector` 参数，
需要改为成功/失败双收集器后才能用于当前执行器。它仍解析并传递 `--max-failures`，
但当前执行器不再读取该配置；该选项不能提供失败预算。 `deno task bench:concurrency`
指向此脚本，不能据此认为该任务已完成适配。

[文件收集器](deps/bench/collector/file_collector.ts)、 [分析器](deps/bench/analyzer/sample_group.ts) 和
[SVG 报告](deps/bench/reporter/SvgReporter.ts) 已按三元组与成功/失败分流重写：

- `openFileCollector(filePath)` 为单个样本文件创建收集器，成功与失败样本应分别打开两个文件； `writeFileResult` /
  `readFileResult` 单独保存和读取运行结果 JSON。样本文件头记录基准时间和精度，
  默认以微秒存储相对时间。`writeFileSamples(filePath, samples)` 可把内存中的样本写成同样的格式。
- `analyzeSampleGroup({ run, successSamples, failedSamples })` 按请求发起时间所在阶段归组延迟，
  资源曲线和阶段平均值只覆盖正式测量窗口。
- `renderSvg({ path, results, panels? })` 上半部分依次绘制并发、QPS、CPU、RSS、扩展内存、JS 堆曲线， 并在图表下方按
  `panels[].ranking` 展示各并发阶段的平均值排行；下半部分按阶段列出 p50/p75/p90/p99、 均值与 RME。

[报告编排](utils/resource-runner.ts) 尚未切换到上述新签名，仍按旧的 `(dir, name)` 约定和单收集器读取结果。

[concurrency-fast.bench.ts](test/concurrency-fast.bench.ts) 已使用新的收集器参数，
但当前把成功和失败样本存入同一数组；需要区分结果时应改用独立收集器。 该脚本当前配置为并发 `500`、预热 `100ms`、测量
`2000ms`，仅在内存中保留结果，不生成 SVG。

报告目录 `benchmark/results` 已被忽略，不应作为源码提交。

## 类型检查

从仓库根目录检查当前执行器，无需数据库：

```powershell
deno check --no-config .\benchmark\deps\bench\ConcurrencyBench.ts
```

## TCP 写入调度基准

在仓库根目录执行，不需要 PostgreSQL：

```powershell
deno run -A --frozen .\benchmark\test\write.bench.ts
```

[write.bench.ts](test/write.bench.ts) 自动以 `Deno.Command` 启动独立的 [tcp-server.ts](utils/tcp-server.ts)
进程。服务端只监听 `127.0.0.1` 的随机端口，输出 PID 和端口后， 客户端通过 `Deno.connect` 建连。双方开启
`TCP_NODELAY`。基准退出时关闭子进程的标准输入， 服务端随之关闭监听和连接；启动、传输和退出均有 10 秒超时。

### 测量口径

- 比较当前 [BufferShortWriter 和 BufferWriter](../src/_utils/StreamWriter.ts)，不替换其内部调度逻辑。
- 两者均使用 8 KiB 写缓冲区、相同且预先分配的数据块，单连接上一次只运行一个批次。
- `BufferShortWriter` 按原生 API 逐次 `await writeData()`，批次末尾显式 `await flush(0)`； `BufferWriter` 按原生 API
  连续调用 `pushData()`，由其自身调度写入和尾部刷新。
- 服务端读取一个四字节批次长度，再收取指定数量的字节，最后回复八字节 ACK：已收字节数和负载 `read()` 次数。
  客户端同时核对实际写入字节数和 ACK 字节数；这是长度检查，不是逐字节内容校验。
- 计时从提交负载之前开始，到收到完整 ACK 且最后一次底层写入完成为止，包含服务端接收和 ACK 的往返成本。
  建连、批次长度头的发送、数据块分配和预热不计入样本。
- 每个场景先预热 8 轮，再采样 32 轮；每轮交替两种 writer 的执行顺序。
- `submit` 是提交循环返回的耗时：队列式 writer 只需入队，短 writer 会等待部分或全部 I/O，
  因此不能只用这个指标比较完成速度。
- `first write` 是从开始提交到首次调用底层 `connection.write()` 的时间，不是服务端首字节到达时间。
- `writes/batch`、`bytes/write` 统计真实负载写调用，不包括长度头；`reads/batch` 来自服务端。 `MiB/s`
  按所有计时样本的总字节数和总耗时计算，包含 ACK 成本。

### 本机结果与改进方向

2026-10-17，Windows、Deno 2.9.7，以下为第二次完整运行的批次 p50。两次完整运行均通过全部字节计数检查，
独立服务端进程均正常退出。当前 `BufferShortWriter.writeData()` 的触发条件已修正为 `writableLength <= flushThreshold`。

| 场景                                 | BufferShortWriter | BufferWriter | 底层写调用数（短 / 队列） |
| ------------------------------------ | ----------------: | -----------: | ------------------------: |
| 单个 52 B                            |          0.169 ms |    15.308 ms |                     1 / 1 |
| 32 × 52 B                            |          0.209 ms |    14.840 ms |                     1 / 1 |
| 10,000 × 52 B                        |          4.057 ms |    14.878 ms |                 127 / 127 |
| 10,112 × 52 B，无尾部残留            |          3.178 ms |     3.552 ms |                 128 / 128 |
| 1024 × 1 KiB                         |          4.733 ms |    15.707 ms |                 256 / 205 |
| 1025 × 1 KiB，队列 writer 无尾部残留 |          4.488 ms |     4.202 ms |                 257 / 205 |
| 64 × 64 KiB                          |         12.738 ms |     8.377 ms |                  512 / 64 |

对齐场景是根据当前阈值与块大小选择的，用于排除队列 writer 的尾部定时刷新： 52 B 的块每 79 个触发一次写入；1 KiB
的块在队列 writer 中每 5 个触发一次写入。 两种实现的阈值边界不同，短 writer 在已用空间达到一半时发送，队列 writer
在超过一半时发送。 修改实现或缓冲区大小后，应重新检查这些场景是否仍然对齐。

优化应按以下顺序进行：

1. **队列 writer：优先增加显式的异步刷新或排空能力，避免协议完成边界依赖 `setTimeout(0)`。** 单个 52 B 的首次写调用 p50
   为 14.776 ms，短 writer 为 0.047 ms。两者都只写一次， 差距来自开始发送前的等待，而不是 TCP
   写调用数量。可考虑单次微任务触发写入泵，但需要保持批量合并，
   并对长队列保留适当的事件循环让出机制。不能通过提前返回入队完成来冒充数据已发送完成。
2. **队列 writer：同步处理只复制内存的队列项，仅真实 I/O 或异步生产数据时等待 Promise。** 当前每个 `pushData`
   都产生队列项、调用 `async writeData` 并注册 `.then()`。无尾部残留的 52 B 场景中， 相同写调用数下短 writer
   略快；这是进一步 profiling 的方向，但差距远小于尾部定时器造成的延迟， 不能把全部性能差异归因于 Promise。
3. **短 writer：为空缓冲区中的大数据增加直接写入路径。** 64 KiB 输入目前被复制并拆成 8 次写入；队列 writer
   可以直接写原始数据，每块只调用一次。 大块场景中队列 writer 的平均吞吐为 467.97 MiB/s，短 writer 为 307.75 MiB/s。
   直写应保留部分写入处理和数据生命周期约束，已有缓冲内容则必须先按顺序处理。
4. **短 writer：减少无 I/O 路径上的异步开销，但保留已有调用签名和顺序约束。** 调用方仍逐条 `await` 时，仅移除函数的
   `async` 关键字并不能消除调度开销； 进一步优化应考虑批量提交或内部同步快路径，而不是并发调用同一个短 writer。
5. **明确完成与错误语义后再调阈值。** 队列 writer 需要让排空等待者感知写入失败；
   两者都应避免零进展写入导致循环不退出。调整阈值时应同时观察小批量延迟、大块吞吐和尾部残留，
   不能只根据入队耗时或更少的写调用判断更快。

以上是原生 TCP 的收发对照，没有 SQL 编码、结果解码或连接池调度；仍受系统调度、运行时预热和机器负载影响。
本次仅新增基准和分析，没有修改生产 writer。

## 本机测量与优化方向

以下是此前 PostgreSQL 查询基准的定位结果，测量时尚未修正短 writer 的触发条件，不代表当前源码的性能。
2026-10-17，Windows、Deno 2.9.7、`postgres` 3.4.9，在相同数据库上连续启动三个独立进程，各项均为 10,000 次成功、0 错误：

| 次数 | postgres |   fake | @asla/pg |
| ---- | -------: | -----: | -------: |
| 1    |   317 ms | 519 ms |  1460 ms |
| 2    |   278 ms | 568 ms |  1500 ms |
| 3    |   283 ms | 535 ms |  1395 ms |

定位开销时得到以下证据：

1. 原 [FakeRequest](../src/implement/FakeRequest.ts) 的 `count` 始终为 0，虽然建立 4 条连接，却只使用第一条。
   仅在实验进程中改为轮询后，整批耗时从约 615 ms 降至 284 ms。单独启用 `TCP_NODELAY` 未显示稳定收益，
   因此不能把差距主要归因于 Nagle 算法。
2. 此前 [BufferShortWriter](../src/_utils/StreamWriter.ts) 在剩余可写空间较大时就执行底层写入；
   [写队列](../src/protocol/MessageWriteQueue.ts) 又逐帧等待 `Parse / Bind / Describe / Execute / Flush / Sync`。 10,000
   次查询实测产生 60,000 次底层写调用。只在实验进程中改为合并帧后，写调用降至 10,000 次， 两组耗时分别由 1623 / 1472 ms
   降至 603 / 539 ms，约提升 2.7 倍。
3. `postgres` 会合并写入，并调度有上限的流水线，而不是每个协议帧一次异步写入。
4. 测量时工作区的 [读队列](../src/protocol/MessageReadQueue.ts) 已注释掉 DataRow 和 RowDescription 处理， `@asla/pg` 的
   `select 1 as x` 实际返回 `[]`。因此当前差距不能解释成结果解码太慢，也不是完整正确性下的性能对比。

改进 `@asla/pg` 时应在保持写缓冲触发条件正确的基础上，合并一条查询的帧，再评估跨查询批量写入和有界流水线；
不要优先删除解码或错误处理。完整客户端还必须恢复结果检查，并保证查询完成、连接归还与 `ReadyForQuery`
的同步边界正确。上述定位实验没有改动生产实现，也没有改动已有 `fake`。
