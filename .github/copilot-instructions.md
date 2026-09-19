# Copilot 说明

## 仓库定位

- 这是一个同时支持 Deno 和 Node.js 的 PostgreSQL 客户端库，发布名为 `@asla/pg`。
- 库直接实现 PostgreSQL Frontend/Backend Protocol 3.0。
- 唯一发布入口是 [src/mod.ts](../src/mod.ts)。新增能力应从该入口导出，不要创建实验性子路径。
- 连接、连接池、查询、游标和 COPY API 是当前长期支持的主 API。

## 架构边界

- `src/mod.ts` 是唯一发布入口，聚合稳定的公共 API 与兼容 API。
- 协议编解码、认证和传输位于底层；连接生命周期、查询、游标和 COPY
  位于其上层。修改时优先定位拥有该行为的模块，不依赖特定目录布局。
- SQL 模板、参数编码与语句类型信息独立于连接状态机；跨 Deno 和 Node.js 的差异通过流适配或接口注入隔离。
- `test/` 按能力覆盖协议单元测试与真实 PostgreSQL 集成测试；测试 fixture、Docker 配置和文档是相应的辅助资源。

## 协议文档索引

- 涉及认证、简单查询、扩展查询或 COPY 时，先查阅
  [认证](../docs/pg-protocol/认证.md)、[简单查询](../docs/pg-protocol/简单查询.md)、[扩展查询](../docs/pg-protocol/扩展查询.md)
  和 [COPY 协议](../docs/pg-protocol/COPY协议.md) 的约束与示例。
- 面向现有用户的 API 迁移和兼容性变更，参考 [原生协议迁移说明](../docs/migration-native-protocol.md)。

## 设计与编码约定

- 保留显式 `.ts` 导入后缀和现有 Deno 模块风格；跨运行时能力通过接口或回调注入。
- 优先修改直接拥有行为的模块：协议编解码、查询结果处理和连接状态机保持各自职责边界，不要跨层复制逻辑。
- 复杂公共接口使用独立的 `XxxImpl implements Xxx` 实现；公共入口优先导出接口和稳定类型，不无意扩大内部实现类的
  公共承诺，非必要不要导出实现类。
- 所有从 `@asla/pg` 导出的声明必须有 JSDoc `@public`。待移除的兼容 API 必须同时保留 `@deprecated`，并指明替代 API。
- 除非任务明确要求破坏性变更，否则保持公共签名稳定。
- 注释应简洁并解释约束或状态机原因；对不直观的公共方法、选项、错误和资源行为补充 JSDoc 与示例。
- 示例和实现优先使用 `using` 或 `await using` 自动释放连接、事务和游标。

## 测试约定

- 除认证测试外，连接与连接池测试应从 [test/fixtures/db_connect.ts](../test/fixtures/db_connect.ts) 获取
  `PgConnection`，不要重复 建立连接。
- 行为测试按能力归入现有测试区域；避免用多层 `describe` 堆叠场景，也不要依赖特定测试文件名。
- 协议单元测试使用可控 `ByteStream`，覆盖短读、EOF、非法长度、并发读取锁和关闭顺序。
- 集成测试使用 Docker PostgreSQL。默认环境变量包括：
  - `TEST_LOGIN_DB`：可创建和删除临时数据库的管理员连接。
  - `TEST_PASSWORD_DB`：cleartext password 测试连接。
  - `TEST_SCRAM_DB`：SCRAM-SHA-256 测试连接。
  - `TEST_TLS_DB` 和 `TEST_TLS_CA`：真实 TLS 连接与测试 CA。
- 新增连接资源的测试必须在 teardown 中释放，并保留连接池借出数量检查。

## 文档要求

- README 示例必须只使用真实从 `@asla/pg` 导出的 API，并优先展示原生 API。
- README 和 CHANGELOG 面向使用者描述可观察能力、迁移方式和兼容性，不提内部路径或用户无法感知的实现细节。
