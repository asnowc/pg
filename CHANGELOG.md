# Changelog

## Unreleased

### Added

- 根入口新增长期支持的原生 PostgreSQL 协议连接 API。
- 新增 TLS `disable`/`prefer`/`require` 协商、StartupMessage、trust、cleartext password 和 SCRAM-SHA-256 认证。
- 新增 Deno `Conn` 与 Node.js `Duplex` 字节流适配器。
- 新增简单查询、扩展查询、查询 reader、游标、COPY IN/OUT 和 SQL 模板参数编码。
- 日期时间参数与查询结果使用 Temporal API；支持 `PlainDate`、`PlainTime`、`PlainDateTime` 和 `Instant`。
- 新增正确拼写的 `copyFrom()`。
- `createDbConnection()` 和 `PgDbQueryPool` 改用内置原生协议实现，并删除 `pg`、`pg-cursor` 及其类型依赖。

### Deprecated

- `createDbConnection()`、`PgDbQueryPool`、`DbQuery`、`DbConnection` 和 `DbCursor` 等旧查询 API 已标记为废弃。
- `DbManage`、`execSqlFile()` 等旧工具 API 已标记为废弃。这些 API 将在后续版本移除，请迁移到 `@asla/pg`
  导出的原生连接、查询、游标和 COPY API。

### Not Supported

- PostgreSQL MD5、GSSAPI/SSPI 认证。
- 物理和逻辑复制协议。
