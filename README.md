[![JSR version][jsr]][jsr-url]

[jsr]: https://jsr.io/badges/@asla/pg
[jsr-url]: https://jsr.io/@asla/pg

PostgreSQL 查询工具，支持 Deno 和 Node.js。兼容字符串 SQL、SQL 模板对象以及带类型信息的语句对象。

[API 文档](https://jsr.io/@asla/pg/doc)

## 安装

项目支持通过 JSR 使用。Deno 项目可以直接导入包：

```ts
import { connectFromStream, DenoConnByteStream } from "@asla/pg";
```

Node.js 项目可以使用 JSR 的 npm 兼容方式，并通过 `NodeDuplexByteStream` 适配 Node.js socket。两个运行时使用相同的原生连接、查询、事务、游标和 COPY API；差异仅在底层 TCP/TLS 流适配方式。

## 连接

### Deno 连接

```ts
import { connectFromStream, DenoConnByteStream } from "@asla/pg";

const tcp = await Deno.connect({ hostname: "127.0.0.1", port: 5432 });
const conn = await connectFromStream(new DenoConnByteStream(tcp), {
  user: "postgres",
  database: "app",
});

const row = await conn.query(`SELECT 1`).getRows();
console.log(row);
await conn.close();
```

### Node.js 连接

```ts
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { connectFromStream, NodeDuplexByteStream } from "@asla/pg";

const socket = connectTcp({ host: "127.0.0.1", port: 5432 });
const conn = await connectFromStream(new NodeDuplexByteStream(socket), {
  user: "postgres",
  database: "app",
});
const row = await conn.query(`SELECT 1`).getRows();
console.log(row);
await conn.close();
```

### TLS

TLS 通过 `tls` 选项配置。`upgrade` 回调负责在 PostgreSQL SSLRequest 成功后完成平台相关的 TLS 握手、校验证书，并返回升级后的流。

#### Deno

```ts
const tcp = await Deno.connect({ hostname: "db.example.com", port: 5432 });
const stream = new UpgradableDenoStream(tcp);
const conn = await connectFromStream(stream, {
  user: "postgres",
  database: "app",
  tls: {
    mode: "require",
    upgrade: () => stream.upgradeTls("db.example.com", ["./ca.crt"]),
  },
});
```

`UpgradableDenoStream` 需要由应用程序实现：它包装 `Deno.TcpConn`，并在 `upgradeTls()` 中调用 `Deno.startTls()` 后继续实现 `ByteStream` 接口。仓库测试中的 `UpgradableDenoStream` 展示了完整实现。

#### Node.js

Node.js 应在 `upgrade` 回调中使用 `node:tls` 将现有连接升级为 TLS，并返回仍实现 `ByteStream` 的适配器。适配器需要保留 PostgreSQL 连接使用的同一条底层连接：

```ts
const socket = connectTcp({ host: "db.example.com", port: 5432 });
const stream = new UpgradableNodeStream(socket);
const conn = await connectFromStream(stream, {
  user: "postgres",
  database: "app",
  tls: {
    mode: "require",
    upgrade: () => stream.upgradeTls("db.example.com"),
  },
});
```

`UpgradableNodeStream` 需要由应用程序使用 `tls.connect()` 和 Node.js Streams API 实现。Deno 和 Node.js 的 `upgrade` 回调都必须完成证书校验，并返回同一连接对应的 TLS 流。

`tls.mode` 的行为如下：

- `disable`：不请求 TLS。
- `prefer`：优先请求 TLS；服务端拒绝时继续使用明文连接。
- `require`：必须成功建立 TLS；服务端拒绝或 TLS 握手失败时连接失败。

认证或协议协商失败后应丢弃底层流，不要继续复用它。

### 认证方式

连接支持 trust、明文密码和 SCRAM-SHA-256 认证。密码可以直接传入字符串，也可以传入同步或异步回调，以便延迟读取密钥：

```ts
const conn = await connectFromStream(stream, {
  user: "app",
  database: "app",
  password: async () => Deno.env.get("PGPASSWORD") ?? "",
  applicationName: "my-service",
});
```

当前不支持 MD5、GSSAPI 和 SSPI 认证。

### 连接池

当前提供单连接 `PgConnection`，不内置连接池工厂。需要连接池时，应由应用层管理多个连接，或使用仓库中仍保留的兼容连接池 API。建议通过 `await using` 确保连接释放。

## 查询

### 简单查询

`simpleQuery()` 使用 PostgreSQL 简单查询协议，适合执行多条 SQL，也可以接收 SQL 字节流。它返回一个异步可迭代对象，每次迭代对应一个结果：

协议说明：<https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-SIMPLE-QUERY>

```ts
for await (const result of conn.simpleQuery(
  "SELECT 1::int AS value; SELECT 'second' AS value",
)) {
  console.log(result.rows, result.rowCount, result.fields);
}
```

简单查询不会自动绑定参数。不要把不可信输入拼接进 SQL 文本；需要传参时使用扩展查询和 SQL 模板。

### 扩展查询

`query()` 使用 PostgreSQL 扩展查询协议，只执行单条 SQL，适合参数化查询和需要类型化结果的场景。协议说明：<https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-EXT-QUERY>

它返回一个 `QueryReader<T>`。`T` 只描述查询结果在应用中的类型，不会改变服务端返回的数据；实际字段解析由默认解析器或查询选项中的自定义解析器完成。

同一个 reader 只能选择一种消费方式：

- `getRows()`：获取所有行，也可以传入 `limit` 限制读取的最大行数。
- `getFirstRow()`：只获取第一行，没有结果时返回 `null`。
- `getMap(key)`：按指定字段建立 `Map`，字段值作为 key。
- `for await...of`：逐行异步读取，适合不希望一次性保存全部结果的场景。
- `getCompletion()`：获取行数、字段和通知信息；它不与上述行读取方法冲突，适合在查询结束后读取完成状态。

例如，查询单行：

```ts
const user = await conn
  .query<{ id: number; name: string }>(
    "SELECT id, name FROM users WHERE id = 42",
  )
  .getFirstRow();
```

批量读取或建立索引时，可以选择其他消费方式：

```ts
const users = await conn
  .query<{ id: number; name: string }>("SELECT id, name FROM users")
  .getMap("id");

const query = conn.query<{ id: number; name: string }>("SELECT id, name FROM users");
for await (const user of query) {
  console.log(user.id, user.name);
}
```

不要把不可信输入拼接进 SQL 文本；需要传参时使用 SQL 模板或其他参数化语句。

### 模版字符串

```ts
import { createSqlBuilder, JS_DATA_ENCODER_V1 } from "@asla/pg";

const sql = createSqlBuilder(JS_DATA_ENCODER_V1);
const userId = 42;

const user = await conn
  .query<{ id: number; name: string }>(
    sql`SELECT id, name FROM users WHERE id = ${userId}`,
  )
  .getFirstRow();
```

模板中的值会按参数绑定编码。`sql.raw()` 会直接嵌入 SQL 文本，只应传入应用程序控制的标识符或片段，不要用于未经验证的用户输入。

模板语句也可以与自定义数据类型解析配合使用。`.setDecoder<T>()` 用于为模板语句补充结果类型信息；真正的字段解析器通过 `query()` 的 `typeDecoders` 或 `columnDecoders` 选项提供。

### 事务

```ts
await using tx = conn.begin();

await tx.query("UPDATE users SET score = score + 1 WHERE id = 1").getCompletion();
await tx.query("INSERT INTO logs(message) VALUES('updated user 1')").getCompletion();
await tx.commit();
```

未显式调用 `commit()` 或 `rollback()` 时，离开 `await using` 作用域会自动回滚并释放事务资源。事务支持 `SERIALIZABLE`、`REPEATABLE READ`、`READ COMMITTED` 和 `READ UNCOMMITTED` 隔离级别。

例如指定串行化隔离级别：

```ts
await using tx = conn.begin("SERIALIZABLE");
```

### 游标

按批读取：

```ts
await using cursor = conn.openCursor<{ id: number }>(
  "SELECT id FROM users ORDER BY id",
  { iteratorMaxRows: 100 },
);

let rows = await cursor.read(100);
while (rows.length > 0) {
  console.log(rows);
  rows = await cursor.read(100);
}
```

也可以直接异步迭代：

```ts
await using cursor = conn.openCursor<{ id: number }>("SELECT id FROM users ORDER BY id", {
  iteratorMaxRows: 100,
});

for await (const row of cursor) {
  console.log(row);
  if (row.id > 1000) break;
}
```

行为说明：

- `close()` 可重复调用
- 提前退出异步迭代时，游标会自动关闭
- 同一个游标不能并行调用 `read()`

### COPY

COPY IN 使用 `copyFrom()` 获取写入句柄。数据可以逐块写入，关闭写入端后客户端会发送 `CopyDone` 并等待服务端完成：

```ts
const copy = conn.copyFrom("COPY users FROM STDIN WITH (FORMAT csv)");
await copy.write(new TextEncoder().encode("1,Ada\n"));
await copy.write(new TextEncoder().encode("2,Grace\n"));
const completion = await copy.closeWrite();
console.log(completion.rows);
```

也可以使用 `copy.writable`：

```ts
const copy = conn.copyFrom("COPY users FROM STDIN WITH (FORMAT csv)");
const writer = copy.writable.getWriter();
await writer.write(new TextEncoder().encode("1,Ada\n"));
await writer.close();
await copy.complete;
```

写入失败时调用 `copy.abort(reason)`，客户端会发送 `CopyFail`。COPY 数据块不保证与 CSV 行边界一致，应用层不能依赖一次 `write()` 对应一行。

COPY OUT 返回 `ReadableStream<Uint8Array>`：

```ts
const output = conn.copyTo("COPY (SELECT id, name FROM users) TO STDOUT WITH (FORMAT csv)");
const reader = output.getReader();
const chunks: Uint8Array[] = [];
for (;;) {
  const { done, value } = await reader.read();
  if (done) break;
  chunks.push(value);
}
console.log(new TextDecoder().decode(concatChunks(chunks)));
```

示例中的 `concatChunks` 由应用程序实现，用于拼接字节块；生产代码也可以边读取边写入文件或其他输出流。不再需要剩余数据时可以取消 reader。连接会继续排空当前 COPY 查询，之后仍可执行新的查询。

### 自定义数据类型解析

内置解析器覆盖常用 PostgreSQL 类型。对于扩展或自定义类型，可以通过 `typeDecoders` 按类型 OID 注册解析器，或通过 `columnDecoders` 按结果列注册解析器。解析器需要同时实现文本格式和二进制格式：

```ts
import type { PgDataDecoder } from "@asla/pg";

const pointDecoder: PgDataDecoder<{ x: number; y: number }> = {
  text(value) {
    const [x, y] = value.slice(1, -1).split(",").map(Number);
    return { x, y };
  },
  binary(value) {
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    return { x: view.getFloat64(0), y: view.getFloat64(8) };
  },
};

const typeDecoders = new Map([[12345, pointDecoder]]); // 12345 替换为数据库中的类型 OID
const points = await conn
  .query<{ point: { x: number; y: number } }>("SELECT point FROM locations", { typeDecoders })
  .getRows();
```

如果只需要处理某一列，可以使用 `columnDecoders`，避免影响同一类型的其他列。自定义类型的 OID 可以从 PostgreSQL 的 `pg_type` 系统目录查询；使用二进制结果格式时，`binary()` 必须按照该类型的 PostgreSQL 二进制格式解析数据。

## 工具函数

### 解析连接串

连接选项由应用程序直接传给 `connectFromStream`。如果应用已有连接串解析器，可以将解析后的 `user`、`database`、密码和其他启动参数传入连接函数；本项目不要求使用特定的连接串格式。

### 执行 SQL 文件

SQL 文件可以使用 `Deno.readTextFile()` 或 Node.js 文件 API 读取，再通过 `simpleQuery()` 执行：

```ts
const migration = await Deno.readTextFile("./migrations/init.sql");
for await (const result of conn.simpleQuery(migration)) {
  console.log(`affected rows: ${result.rowCount}`);
}
```

### 管理测试或临时数据库

测试数据库的创建、删除和生命周期由应用程序或测试框架负责。连接当前数据库后，可以通过 `conn.query()` 或 `conn.simpleQuery()` 执行相应的 PostgreSQL 管理语句；执行数据库级操作时请使用具备对应权限的管理连接。
