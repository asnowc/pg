# Copilot 说明

## 仓库定位

- 这是一个同时支持 Deno 和 Node.js 的 PostgreSQL 客户端库，发布名为 `@asla/pg`，直接实现 PostgreSQL Frontend/Backend
  Protocol 3.0。
- 唯一发布入口是 [src/mod.ts](../src/mod.ts)，聚合稳定的公共 API 与兼容
  API。新增能力从该入口导出，不要创建实验性子路径。
- 连接、连接池、查询、游标和 COPY API 是长期支持的主 API。

## 架构边界

- 协议编解码、认证和传输位于底层；连接生命周期、查询、游标和 COPY 位于其上层。修改时定位直接拥有该行为的模块，
  不跨层复制逻辑，也不依赖特定目录布局。
- SQL 模板、参数编码与语句类型信息独立于连接状态机。
- 跨 Deno 和 Node.js 的差异通过流适配或接口/回调注入隔离。
- `test/` 按能力覆盖协议单元测试与真实 PostgreSQL 集成测试。
- `benchmark/` 不属于发布内容，见下文 [基准测试](#基准测试)。

## 协议文档索引

- 涉及认证、简单查询、扩展查询、异步消息或 COPY 时，先查阅 [认证](../docs/pg-protocol/认证.md)、
  [简单查询](../docs/pg-protocol/简单查询.md)、[扩展查询](../docs/pg-protocol/扩展查询.md)、
  [异步消息与取消](../docs/pg-protocol/异步与取消.md) 和 [COPY 协议](../docs/pg-protocol/COPY协议.md) 的约束与示例。
- 面向现有用户的 API 迁移和兼容性变更，参考 [原生协议迁移说明](../docs/migration-native-protocol.md)。

## 设计与编码约定

- 保留显式 `.ts` 导入后缀和现有 Deno 模块风格。
- 复杂公共接口使用独立的 `XxxImpl implements Xxx` 实现；公共入口优先导出接口和稳定类型，非必要不导出实现类，
  避免无意扩大公共承诺。
- 所有从 `@asla/pg` 导出的声明必须有 JSDoc `@public`；待移除的兼容 API 同时保留 `@deprecated` 并指明替代 API。 JSDoc
  细则见 [jsdoc.instructions.md](instructions/jsdoc.instructions.md)。
- 除非任务明确要求破坏性变更，否则保持公共签名稳定。
- 注释应简洁，解释约束或状态机原因；对不直观的公共方法、选项、错误和资源行为补充 JSDoc 与示例。
- 示例和实现优先使用 `using` 或 `await using` 自动释放连接、事务和游标。

## 常用命令

在仓库根目录执行：

- 类型检查：`deno task type:check`
- 运行测试：`deno task ci:test`；只运行相关文件时使用 `deno x vitest run <path>`
- 格式化：`deno fmt`（行宽 120）

## 测试约定

- 没有明确要求时不要添加测试。
- 修复指定测试文件后，只需运行该文件，无需运行全部测试。
- 除认证测试外，连接与连接池测试从 [test/fixtures/db_connect.ts](../test/fixtures/db_connect.ts) 获取 `PgConnection`，
  不要重复建立连接。
- 行为测试按能力归入现有测试区域；避免用多层 `describe` 堆叠场景，也不要依赖特定测试文件名。
- 新增连接资源的测试必须在 teardown 中释放，并保留连接池借出数量检查。
- 集成测试使用 Docker PostgreSQL（根目录 `docker compose up -d`），环境变量：
  - `TEST_LOGIN_DB`：可创建和删除临时数据库的管理员连接。
  - `TEST_PASSWORD_DB`：cleartext password 测试连接。
  - `TEST_SCRAM_DB`：SCRAM-SHA-256 测试连接。
  - `TEST_TLS_DB` 和 `TEST_TLS_CA`：真实 TLS 连接与测试 CA。

## 基准测试

- `benchmark/` 使用独立的 `deno.json` 与 `package.json`，命令在该目录下执行。
- [benchmark/deps](../benchmark/deps/) 下的 `bench/`、`bench-cli/` 及入口 `bench.ts`、`bench-cli.ts`
  是通用基准工具，将来会独立为单独的仓库：
  - 不得引用 `@asla/pg`、`src/` 或 `benchmark/` 下的项目代码；项目相关内容放在 `benchmark/client`、`benchmark/test` 和
    `benchmark/utils`。
  - 工具用法写入 [benchmark/deps/bench/README.md](../benchmark/deps/bench/README.md)，修改工具行为或选项时同步更新。
- [benchmark/README.md](../benchmark/README.md)
  只面向本项目读者：如何准备环境、运行本项目的基准、可比较的系列和测量记录； 不写工具内部实现或通用 API。
- `benchmark/results` 是运行输出，不要提交。验证报告时复用已有结果目录，执行 `report <dir>` 即可，无需重新运行基准。

## 文档要求

- README 示例只能使用真实从 `@asla/pg` 导出的 API，并优先展示原生 API。
- README 和 CHANGELOG 面向使用者描述可观察能力、迁移方式和兼容性，不提内部路径或用户无法感知的实现细节。
