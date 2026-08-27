# Copilot 说明

## 仓库定位

- 这是一个以 Deno 为优先的 PostgreSQL 库，发布名为 `@asla/pg`。
- 公共 API 从 [src/mod.ts](src/mod.ts) 对外导出，并经由 [src/abstract/mod.ts](src/abstract/mod.ts)、[src/impl/mod.ts](src/impl/mod.ts) 和 [src/util.ts](src/util.ts) 重新导出。
- 修改应尽量小而集中，并围绕现有抽象展开：`DbQuery`、`DbQueryPool`、池连接、事务与游标。

## 编码约定

- 保留显式的 `.ts` 导入后缀以及现有的 Deno 模块风格。
- 优先做小范围、针对性的修改，避免无关重构。
- 除非任务明确要求变更 API，否则保持公开类型签名稳定。
- 保持现有代码风格：注释简洁、导出的公共声明使用 `@public`、避免引入不必要的中间封装。
- 这个仓库很重视资源生命周期。示例和测试中凡是需要自动释放连接、事务或游标的场景，优先使用 `using` 或 `await using`。

## 行为预期

- `PgDbQueryPool.begin()` 是懒加载的：在第一条语句执行前，不要提前占用数据库连接。
- 事务对象在释放时，如果既没有调用 `commit()` 也没有调用 `rollback()`，仍应自动回滚。
- 游标实现不应允许并行 `read()`，并且在 `close()` 时必须释放底层连接池连接。
- 已 `release()` 的池连接不应继续可用。

## 验证要求

- 变更涉及类型或导出 API 时，运行 `deno task type:check`。
- 行为变更优先运行聚焦的 Vitest 测试文件，必要时再扩大范围。
- 全量测试命令是 `deno task ci:test`。
- 集成测试依赖 `TEST_LOGIN_DB`，它必须指向一个有权限创建和删除临时数据库的 PostgreSQL 数据库。

## 文档要求

- README 中的示例必须与真实导出的 API 保持一致。
- 只要某个可观察行为会影响使用者，就应在文档中说明，尤其是释放、自动回滚和连接回收语义。