# Copilot 说明

## 仓库定位

- 这是一个以 Deno 为优先、同时支持 Node.js 的 PostgreSQL 客户端库，发布名为 `@asla/pg`。
- 库直接实现 PostgreSQL Frontend/Backend Protocol 3.0。
- 唯一发布入口是 [src/mod.ts](../src/mod.ts)。新增能力应从该入口导出，不要创建实验性子路径。
- 原生连接、查询、游标和 COPY API 是当前长期支持的主 API。

## 项目结构

- [src/mod.ts](../src/mod.ts)：公共入口，聚合原生 API 和待移除的兼容 API。
- [src/connect/](../src/connect/)：认证完成后的连接 API 与实现。
- [src/protocol/](../src/protocol/)：协议和传输层。
- [src/query/](../src/query/)：查询输入、结果 reader、游标契约及数据解码器。
- [src/sql/](../src/sql/)：`sql` 模板、JavaScript 参数编码和类型化 statement。
- [src/platforms.ts](../src/platforms.ts)：Deno `Conn` 与 Node.js `Duplex` 的 `ByteStream` 适配器。
- [src/util/](../src/util/)：工具函数和辅助模块。
- [src/lib/pool.ts](../src/lib/pool.ts)：兼容连接池使用的通用资源池。
- [test/tests/connect/](../test/tests/connect/)：原生连接、查询、游标、COPY、TLS 和生命周期集成测试。
- [test/tests/driver/protocol/](../test/tests/driver/protocol/)：消息帧与编解码单元测试。
- [test/tests/authentication.test.ts](../test/tests/authentication.test.ts)：直接建立连接并验证认证流程。
- [test/fixtures/db_connect.ts](../test/fixtures/db_connect.ts)：数据库、明文连接和 TLS 连接的 Vitest fixtures。
- `docker-compose.yml`、`dockerfile`、`pg_hba.conf`、`init-auth.sql`：真实 PostgreSQL 认证与 TLS 测试环境。
- [docs/](../docs/)：认证、简单查询、扩展查询、COPY 和迁移说明。

## 设计与编码约定

- 保留显式 `.ts` 导入后缀和现有 Deno 模块风格；跨运行时能力通过接口或回调注入。
- 优先修改直接拥有行为的模块。协议编解码放在 `protocol`，查询结果处理放在 `query`，连接状态机放在
  `connect`，不要跨层复制逻辑。
- 复杂公共接口使用独立的 `XxxImpl implements Xxx` 实现；公共入口优先导出接口和稳定类型，不无意扩大内部实现类的
  公共承诺，非必要不要导出实现类。
- 所有从 `@asla/pg` 导出的声明必须有 JSDoc `@public`。待移除的兼容 API 必须同时保留 `@deprecated`，并指明替代 API。
- 除非任务明确要求破坏性变更，否则保持公共签名稳定。
- 注释应简洁并解释约束或状态机原因；对不直观的公共方法、选项、错误和资源行为补充 JSDoc 与示例。
- 示例和实现优先使用 `using` 或 `await using` 自动释放连接、事务和游标。

## 测试约定

- 除认证测试外，原生连接测试应从 [test/fixtures/db_connect.ts](../test/fixtures/db_connect.ts) 获取
  `PgConnection`，不要重复 建立连接。
- 行为测试按能力拆分文件，优先使用现有的 `simple_query`、`extended_query`、`cursor`、`copy`、`lifecycle` 和 `tls`
  测试文件；避免用多层 `describe` 堆叠场景。
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
