[![JSR version][jsr]][jsr-url]

[jsr]: https://jsr.io/badges/@asla/pg
[jsr-url]: https://jsr.io/@asla/pg

PostgreSQL 查询与连接池工具，面向 Deno，兼容字符串 SQL、SQL 模板对象以及带类型信息的语句对象。

[API 文档](https://jsr.io/@asla/pg/doc)

## 安装

```ts
import { createDbConnection, DbManage, execSqlFile, parserDbConnectUrl, PgDbQueryPool } from "@asla/pg";
```

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

`tls.mode` 可为 `disable`、`prefer` 或 `require`。TLS 证书校验由传入的 `upgrade`
回调负责；认证或协议失败后应丢弃该底层流。

### 认证方式

### 连接池

## 查询

### 简单查询

### 扩展查询

### 模版字符串

```ts
```

### 事务

```ts
await using tx = pool.begin();

await tx.query("UPDATE users SET score = score + 1 WHERE id = 1");
await tx.query("INSERT INTO logs(message) VALUES('updated user 1')");
await tx.commit();
```

未显式 `commit()` 或 `rollback()` 时，离开 `await using`
作用域会自动回滚并释放连接。测试已经覆盖这个行为，因此事务示例和业务代码都建议采用 `await using`。

也支持事务隔离级别：

```ts
const tx = pool.begin("SERIALIZABLE");
```

### 游标

按批读取：

```ts
await using cursor = await pool.cursor<{ id: number }>(
  "SELECT id FROM users ORDER BY id",
  { defaultSize: 100 },
);

let rows = await cursor.read();
while (rows.length > 0) {
  console.log(rows);
  rows = await cursor.read();
}
```

或者直接异步迭代：

```ts
const cursor = await pool.cursor<{ id: number }>("SELECT id FROM users ORDER BY id", {
  defaultSize: 100,
});

for await (const row of cursor) {
  console.log(row);
  if (row.id > 1000) break;
}
```

行为说明：

- `close()` 可重复调用
- 游标关闭后会释放其占用的池连接
- 不支持并行 `read()`，否则会抛出 `ParallelQueryError`

### COPY

## 工具函数

### 解析连接串

```ts
import { parserDbConnectUrl } from "@asla/pg";

const option = parserDbConnectUrl("postgres://postgres:password@127.0.0.1:5432/app");
```

### 执行 SQL 文件

```ts
import { createDbConnection, execSqlFile } from "@asla/pg";

await using db = await createDbConnection("postgres://postgres:password@127.0.0.1:5432/app");
await execSqlFile("./migrations/init.sql", db);
```

### 管理测试或临时数据库

```ts
import { DbManage } from "@asla/pg";

await using manage = await DbManage.connect("postgres://postgres:password@127.0.0.1:5432/postgres");
await manage.recreateDb("app_test");
```
