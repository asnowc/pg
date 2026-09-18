# 查询基准

在此目录执行 `deno task bench`，或分别执行 `deno task bench:query`、`deno task bench:pool`。 也可从仓库根目录执行
`deno task --cwd benchmark bench`。需要 Deno 和可连接的 PostgreSQL。

- [query.bench.ts](query.bench.ts)：复用固定连接；`pg-promise` 使用 direct connection。 `postgres` 没有无池 Client
  API，因此使用 `max: 1` 并在计时前 `reserve()` 固定物理连接，计时后释放。
- [pool-query.bench.ts](pool-query.bench.ts)：四个客户端均设置最大连接数 4，每次查询调用池级 API。
  基准串行执行，测量借还开销而非 4 路并发吞吐。
- 默认连接 `postgres://postgres@127.0.0.1:5432/test_public`（仓库 Docker 初始化数据库）。可用 `BENCHMARK_DATABASE_URL`
  覆盖，也接受 `TEST_LOGIN_DB`。当前只测明文 TCP，不接受 URL 查询参数或 TLS 配置。

四组查询来自 [../index.js](../index.js)：`select`、`select_arg`、`select_args`、`select_where`。
日期固定，保留七参数查询里的 NULL、布尔、bytea、JSON；在 setup 中检查结果，不把断言或连接建立/关闭计入采样。
每项采样至少 500ms / 20 次，预热至少 100ms / 5 次。

这是源码模式下的公开 API 查询比较：`@asla/pg` 预先构造二进制参数模板，其他客户端使用各自参数序列化；
结果解码器及类型推断策略不同，因此不是仅协议传输速度的对照。 `pg-promise` 使用 `ParameterizedQuery`
进行服务端参数绑定，`postgres` 使用固定 SQL 的 `unsafe(text, values)` 绑定参数并禁用自动 prepared statement 缓存，与
`pg` 的未命名查询策略一致。

`postgres` 将已序列化的 JSON 以 text OID 发送，避免重复 JSON 编码。不要根据单次本机结果推断生产性能。
