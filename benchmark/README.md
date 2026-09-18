# @asla/pg 基准测试

本目录用于比较 `@asla/pg` 与其他 PostgreSQL 客户端在相同查询与并发下的吞吐、延迟和资源占用。 并发执行、结果保存与 SVG
报告由通用基准工具完成，其用法见 [deps/bench/README.md](deps/bench/README.md)。 本目录不属于发布内容。

## 目录

| 路径                                                               | 内容                                        |
| ------------------------------------------------------------------ | ------------------------------------------- |
| [test/postgresql-client.bench.ts](test/postgresql-client.bench.ts) | 客户端查询基准：配置、参与比较的系列与 meta |
| [client/](client/)                                                 | 各第三方客户端的连接池与查询适配            |
| [utils/](utils/)                                                   | 数据库连接配置、`@asla/pg` 适配与系列加载   |
| [deps/](deps/)                                                     | 通用基准工具与命令行                        |
| `results/`                                                         | 运行输出，已被 git 忽略，不应提交           |

## 准备

1. 在仓库根目录用 `docker compose up -d` 启动 PostgreSQL。
2. 连接默认使用 `postgres://postgres@127.0.0.1:5432/test_public`，可通过 `TEST_LOGIN_DB` 覆盖。 当前比较明文 TCP，不读取
   URL 中的 TLS 等查询参数。
3. 在本目录安装依赖：`deno install`。
4. 比较 `@asla/pg-node`（上一版构建产物）时，先在仓库根目录执行 `deno task bundle` 生成 `dist/mod.js`。

`@asla/pg` 系列的连接池通过 `Deno.connect` 建连，需在 Deno 中运行。

## 客户端查询基准

在本目录运行，每个系列在独立子进程中执行，结束后在 `results/postgresql-client.bench-<时间戳>/` 生成 `report.svg`：

```powershell
# 使用文件内配置运行
deno run -A deps/bench-cli/main.ts run test/postgresql-client.bench.ts
# 选择系列、并发档位、每档时长与输出目录
deno run -A deps/bench-cli/main.ts run test/postgresql-client.bench.ts -s fake2,postgres -c 100,250 -d 2000 -o results/tmp
# 为已有结果重新生成报告
deno run -A deps/bench-cli/main.ts report results/tmp -p compact -o report.compact.svg
```

也可以在仓库根目录执行 `deno task bench:pg-client`。meta 可通过 `-m <json>` 覆盖，命令行与报告的全部选项见
[工具文档](deps/bench/README.md#命令行)。

可比较的系列：

| 系列            | 说明                                                                          |
| --------------- | ----------------------------------------------------------------------------- |
| `@asla/pg`      | 当前源码                                                                      |
| `@asla/pg-node` | 上一版构建产物 `dist/mod.js`                                                  |
| `postgres`      | postgres.js，关闭预备语句                                                     |
| `pg`            | node-postgres                                                                 |
| `pg-promise`    | pg-promise                                                                    |
| `slonik`        | slonik                                                                        |
| `fake2`         | 直接使用协议层会话轮询多条连接的调度模拟，用于区分协议层与连接池/查询层的开销 |

meta 参数：

| 参数        | 说明                                                                    |
| ----------- | ----------------------------------------------------------------------- |
| `poolSize`  | 每个系列的连接池大小                                                    |
| `queryName` | `select`（无参数）、`selectArg`（单参数）、`selectArgs`（多种类型参数） |

新增客户端时，在 [client/](client/) 中实现 `PoolQueryTest`，并在 [resource-runner.ts](utils/resource-runner.ts)
中登记系列名。各客户端应执行语义相同的查询并读取完整结果，避免比较结果被省略的解码或不同的查询协议影响。

## 结果解读

- 同一结果目录中的系列使用相同的测试参数与 meta，可直接比较；不同目录、不同机器或不同运行时版本的结果不应混合比较。
- 报告中的倍数是相对同表最低值的比值，需结合标题旁的“越高越好 / 越低越好”提示阅读。
- 单次运行受系统调度、运行时预热和机器负载影响；得出结论前应多次运行，并关注 RME 与尾延迟。
