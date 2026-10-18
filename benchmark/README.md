# 查询基准

## 运行连接池基准

在仓库根目录执行：

```powershell
deno run -A --frozen .\benchmark\test\pool-query.bench.ts
```

需要 Deno 和可连接的 PostgreSQL。连接配置来自 [db.ts](utils/db.ts)，默认地址为
`postgres://postgres@127.0.0.1:5432/test_public`，使用 `TEST_LOGIN_DB` 覆盖。当前比较明文 TCP，不读取 URL 中的 TLS
等查询参数。

[pool-query.bench.ts](test/pool-query.bench.ts) 默认比较 `postgres`、`@asla/pg` 和 `fake` 的 `select`：

- 每个客户端配置 4 条连接，预热 100 次，正式执行 10,000 次。
- 未指定 `maxConcurrency` 时，并发数等于迭代次数，因此会同时提交 10,000 个请求，而不是串行查询或仅 4 个并发请求。
- 客户端之间依次运行；建池、预热和关闭不计入 `totalTime`。真实客户端惰性建连，由预热触发。
- `totalTime` 是整批完成耗时；`mean`、分位数包含客户端排队时间，不是单条 SQL 的纯执行时间。
- `ratio` 相对于当轮最慢客户端。当前 `±` 后面的数值实际是标准差除以均值（变异系数），不是置信区间。
- 当前 runner 只统计调用是否抛错，不断言结果行；成功列实际显示总迭代数，有错误时需另行扣除错误数。

固定连接的其他比较见 [query.bench.ts](test/query.bench.ts)，其并发数和启用的客户端与连接池基准不同。

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
