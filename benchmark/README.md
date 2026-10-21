# 查询基准

## 工具与运行环境

统一入口是 [deps/bench.ts](deps/bench.ts)：并发运行 → 原始样本 → `analyzeSampleGroup` → `renderSvg`。 JavaScript / Node
API 的兼容性约束仅适用于 `benchmark/deps`，该目录不依赖 Deno API、Deno 全局或 polyfill。 `benchmark/test`
中的数据库基准脚本仍用 `deno run` 直接运行，不需要 Node 启动器或预编译。 工具也可通过现有 Vitest 等支持 TypeScript
转换的 Node 工具链运行。ECharts 只在生成 SVG 时加载，不进入 fixed 的被测子进程。 无需浏览器或原生 Canvas；首次运行前在
`benchmark` 目录执行 `deno install` 安装已有依赖。

连接配置来自 [db.ts](utils/db.ts)，默认 `postgres://postgres@127.0.0.1:5432/test_public`， 使用 `TEST_LOGIN_DB`
覆盖。当前比较明文 TCP，不读取 URL 中的 TLS 等查询参数。

## 固定并发资源基准

```sh
deno run -A --frozen ./benchmark/test/fixed-concurrency.bench.ts --pool-size 4 --concurrency=10,20,40,60 --warmup 10 --duration 60 --max-failures 0
```

也可运行 `deno task bench:concurrency` 并传入这些参数。客户端列表仍由 [resource-runner.ts](utils/resource-runner.ts) 的
`libraries` 指定，SQL 为 `select 1 as x`。 不设置目标
QPS，每个客户端一个独立子进程，进程内顺序执行全部并发档，客户端之间也顺序执行。

- `--concurrency <数量列表>`：必填，逗号分隔的正整数，按输入顺序执行，不排序、不去重。
- `--pool-size <数量>`：连接池大小，默认 `4`，与请求并发独立。
- `--warmup <秒数>`：仅第一档预热，默认 `10`；允许 `0`。
- `--duration <秒数>`：每档正式测量时长，默认 `60`，必须为正整数。
- `--max-failures <数量>`：允许的查询失败次数，默认 `0`，必须为非负安全整数。
  累计失败次数**严格超过**上限才停止补发并非零退出；等于上限继续。 预热、所有并发档和最终排空共用预算，不逐档重置。

预热排空后开始正式测量，继续复用连接池。正式档位切换不排空、不重建连接、不重新预热。
降低并发时暂停补发，直到在途数低于新目标，因此切换后在途数可能暂时高于目标。
时限或失败超限后停止补发，等待所有查询完成，再关闭收集器和连接池。 排空、关池和退出不设超时；duration
限制补发时间，不保证进程在指定时限内退出。

输出至 `benchmark/results/fixed-concurrency-<时间戳>/`，根目录由
[fixed-concurrency.bench.ts](test/fixed-concurrency.bench.ts) 的 `OUTPUT_DIRECTORY` 配置：

- `<客户端>.samples.bin`：每次正式启动请求的 `[startTime, endTime, success, id]` 原始样本，
  包含最终排空完成的调用，但不保存预热调用。时间为进程单调时钟的毫秒值。 文件头 8 字节：ASCII `PGBS`、版本 `1`、记录长度
  `25`、两个保留零字节。 每条记录为两个 Float64 时间、一个成功标记字节、一个 Float64 安全整数 id，使用小端序。
- `<客户端>.result.json`：格式版本、样本数量、运行结果、CPU/内存原始快照以及 PID/池大小等元数据。
  仅在测量成功完成、样本刷新成功后写出，运行失败时不生成结果 JSON。 `warmup: { iterations, duration }`
  单独记录预热次数和毫秒耗时，耗时不含排空。 `stageSamples` 记录每档的 `concurrency` 和请求 id 范围
  `[startIndex, endIndex)`； 这些索引不是样本数组位置，完成顺序可能不同于发起顺序。成功/失败数直接从原始样本统计，
  正式测量起止时间来自资源快照的首尾时间。
- `comparison.svg`：全部客户端结束后，由主进程读取原始数据、分析并生成。 不再输出旧的 `results.json` 和旧 ResourceResult
  格式。

文件名去掉开头的 `@` 并替换路径分隔符，如 `asla-pg-node.samples.bin`。
写入不覆盖同名原始文件；只读接口不会创建或修改文件，损坏、截断和计数不符时明确报错。
文件收集器用小块串行写入，默认最多缓存 8 MiB，包含当前、排队和正在写入的块。 可通过
`openFileCollector(dir, name, { maxBufferedBytes })` 调整；达到容量上限时直接报错停止，不等待背压、不丢样后继续。
收集器和文件故障不属于查询失败预算，直接抛出异常并导致非零退出。
失败时可能保留部分样本文件，但不将其作为完整测量结果参与比较。
一个子进程失败不妨碍其他客户端完成；主进程保留其他客户端的报告并记录失败进程。

查看全部选项：`deno run -A ./benchmark/test/fixed-concurrency.bench.ts --help`。

## 内存采样基准

在仓库根目录执行：

```sh
deno run -A --frozen ./benchmark/test/pool-query.bench.ts
deno run -A --frozen ./benchmark/test/query.bench.ts
deno run -A --frozen ./benchmark/test/concurrency-fast.bench.ts
```

三个脚本都改为预热 **1 秒**，按 **100、250、500** 并发各测量 **3 秒**。 默认值在 [utils/bench.ts](utils/bench.ts) 的
`DEFAULT_BENCH_INPUT` 中配置；工具自身的 duration、 warmupDuration 和阶段 duration 使用毫秒，默认分别为 3000 和
0，maxFailures 默认 0。 并发输入支持单个数值、数值数组和 `{ value, duration }[]`。

- 连接池基准保持池大小 `4`，比较现有 `postgres`、`fake`、调度模拟、`@asla/pg` 和 `@asla/pg-node` 项的 select。
- 固定连接基准比较现有客户端的 select/selectArg/selectArgs。旧版本比较项 `@asla/pg-prev` 必须预先提供**旧版本**构建的
  `dist/mod.js`，缺少时明确报错，不跳过，也不能用当前版本构建冒充。
- 在同一进程中依次运行客户端，建连/建池、预热、排空及关闭不计入正式窗口。 内存指标可能受前序客户端遗留内存影响，不等同于
  fixed 的独立进程比较。
- 原始数据仅存在内存；分别输出到 `benchmark/results/query-<时间戳>/`、 `pool-query-<时间戳>/` 和
  `concurrency-fast-<时间戳>/`， 每个查询场景仅写一份 `<查询名>.svg`，没有原始样本或结果 JSON 文件。
- 查询失败在预算内会显示计数但不导致非零退出；超出预算或基础设施故障在关闭资源、生成可用报告后非零退出。

## 图表与统计口径

- SVG 包含 CPU、RSS、JS 堆、外部内存、成功 QPS 和**目标并发**六类曲线，
  目标并发不是实际在途请求数。横轴为各客户端相对正式起点的真实秒数。
  阶段时间从各请求范围内首个请求的发起时间重建；降低并发导致延迟补发时，
  该时间晚于实际切换，空请求范围不伪造采样或耗时。
- CPU/内存正式测量期间每秒采样，并补采起点、阶段边界和终点。 CPU 由累计 user/system 微秒差计算，100%
  表示一个逻辑核心；内存显示 MiB， 是采样时占用而非分配速率或精确峰值，不主动 GC。资源数据包含调度/采样开销，fixed
  还包含文件收集开销。
- 预热不进入正式样本，最终排空不进入资源和 QPS 曲线。 查询按发起请求的 id
  范围归入对应档，跨档完成或最终排空的查询仍归原发起档，计入该档延迟和成功/失败数。 重复并发值仍按档位序号独立统计。
- 每档比较 CPU/内存的时间加权均值和成功 QPS，按均值升序排列，
  每档成功数包含最终排空，以重建的该档测量时长换算每秒成功数； 时间曲线的 QPS 则只统计对应资源采样区间内完成的成功查询。
  倍数仅相对于相同档位的最低值，不表示所有指标越大越好。零分母、未运行档位及缺失数据显示 N/A。
- 延迟仅统计成功调用，包含排队时间；分位数为 nearest-rank，覆盖 p50 至 p99.9。 RME 为 95% Student-t
  均值置信区间相对半宽，不再把变异系数标为 RME。 无成功样本、样本不足或均值为零时，相应统计显示 N/A。
- 失败统计来自正式请求样本，包含这些请求的排空结果，不包含预热；工具本身不验证 SQL 结果行。 `warmup`、`run` 和
  `runWidthCpuAndMemory` 在查询失败超限或采样回调出错时，
  停止补发、等待在途查询完成，然后直接抛出原始异常；结果不携带错误状态字段。 调用方仍负责文件收集器最终的
  flush/close/dispose，异步写入错误也通过这些方法抛出。

报告在已忽略的 `benchmark/results` 下，不应作为源码提交。

## 工具测试

无需数据库即可运行 Node 工具测试和可控子进程测试（子进程编排测试需要 Deno）：

```sh
node benchmark/node_modules/vitest/vitest.mjs run --config benchmark/vitest.config.ts
deno check --config benchmark/deno.json benchmark/deps/bench.ts
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
