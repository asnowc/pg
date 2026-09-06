# v0.2.x 迁移到 v0.3.0 (原生协议 API)

v0.3.0 实现了 Postgresql 的连接协议，不再依赖 npm `pg` 或 `pg-cursor`。

## 导入路径

```ts
// 高层兼容 API
import { createDbConnection, PgDbQueryPool } from "jsr:@asla/pg";

// 原生协议 API
import { connectFromStream, DenoConnByteStream, NodeDuplexByteStream, sql } from "jsr:@asla/pg";
```

## API 映射

| 高层兼容 API              | 原生协议 API                                                   |
| ------------------------- | -------------------------------------------------------------- |
| `createDbConnection(url)` | 自行建立 TCP/TLS 流后调用 `connectFromStream(stream, options)` |
| `db.queryRows(sql)`       | `connection.query(sql).getRows()`                              |
| `db.queryFirstRow(sql)`   | `connection.query(sql).getFirstRow()`                          |
| `db.queryCount(sql)`      | `connection.query(sql).getRowCount()`                          |
| `pool.cursor(sql)`        | `connection.openCursor(sql)`                                   |
| 无对应稳定方法            | `connection.copyFrom(sql)` / `connection.copyTo(sql)`          |

`PgDbQueryPool` 已在内部使用原生连接池；需要直接控制字节流、TLS 或 COPY 时使用 `connectFromStream()`。

## 连接与 TLS

`connectFromStream()` 接受已经连接的 `ByteStream`，因此 DNS、代理、Unix socket、证书存储和 TLS
握手仍由运行平台控制。Deno 使用 `DenoConnByteStream`，Node.js 使用 `NodeDuplexByteStream`。

```ts
const tcp = await Deno.connect({ hostname: "localhost", port: 5432 });
await using connection = await connectFromStream(new DenoConnByteStream(tcp), {
  user: "app",
  database: "app",
  password: async () => Deno.env.get("PGPASSWORD") ?? "",
  tls: {
    mode: "require",
    upgrade: async (stream) => {
      // 使用平台 TLS API 把已接受 SSLRequest 的 stream 升级，并返回新的 ByteStream。
      return await upgradePostgresTls(stream);
    },
  },
});
```

- `disable` 不发送 SSLRequest。
- `prefer` 在服务器回复 `N` 时继续使用明文连接。
- `require` 在服务器拒绝 TLS 时失败并关闭流。
- `upgrade` 必须执行主机名和 CA 校验；库不会绕过平台证书验证。

## 认证差异

原生实现支持 `trust`、cleartext password 和 SCRAM-SHA-256。密码可以是字符串或异步回调，便于延迟读取秘密。MD5、GSSAPI 和
SSPI 会明确报错。认证完成以首个 `ReadyForQuery` 为准，会话参数和 `BackendKeyData` 保存在连接的 session 中。

## 查询行为

参数查询使用 `sql` 模板：

```ts
const result = connection.query(sql`SELECT * FROM users WHERE id = ${42}`);
const user = await result.getFirstRow();
```

`QueryReader` 的行消费方法只能使用一次；`getRows()`、`getFirstRow()`、`getMap()` 和异步迭代
不可混用。连接会顺序执行并发调用，且 SQL 错误会先排空到 `ReadyForQuery`，再允许后续操作。
协议或网络错误后应释放连接并重新建立。

## COPY 与资源生命周期

```ts
const copy = connection.copyFrom("COPY events(payload) FROM STDIN");
await copy.write(bytes);
const { rows } = await copy.closeWrite();
```

`copyForm()` 仍可调用，但已废弃并直接转发到 `copyFrom()`。正常关闭 COPY IN 会发送 `CopyDone`；`abort()` 会发送
`CopyFail`。取消 COPY OUT 后连接会继续排空当前查询周期。

连接、游标应使用 `await using`，或显式调用异步释放/`close()`。重复释放是安全的。游标不允许并行 `read()`。

## 暂不支持与回退

- MD5、GSSAPI、SSPI。
- 物理或逻辑复制（`replication.ts` 仍只是预留契约）。
- 跨查询共享一个 `Sync` 的流水线优化。

高层 API 的公开签名保持不变，但底层连接错误现在使用本库的 `PgDatabaseError`，不再暴露 npm `pg` 的错误对象。
