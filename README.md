[![JSR version][jsr]][jsr-url]

[jsr]: https://jsr.io/badges/@asla/pg
[jsr-url]: https://jsr.io/@asla/pg

PostgreSQL 查询与连接池工具，面向 Deno，兼容字符串 SQL、SQL 模板对象以及带类型信息的语句对象。

[API 文档](https://jsr.io/@asla/pg/doc)

## 安装

```ts
import { createDbConnection, DbManage, execSqlFile, parserDbConnectUrl, PgDbQueryPool } from "jsr:@asla/pg";
```

这个库以 Deno 为优先，同时支持 Node.js，连接、认证、查询、游标和 COPY 均由内置 PostgreSQL 协议实现提供，不依赖 `pg` 或
`pg-cursor`。

## 原生协议 API

原生协议 API 从 `@asla/pg` 根入口导出，并作为长期支持 API。它支持 trust、明文密码、
SCRAM-SHA-256、TLS、简单/参数查询、游标以及 COPY IN/OUT。`createDbConnection()` 和 `PgDbQueryPool`
也使用同一套原生协议实现。

### Deno 连接

```ts
import { connectFromStream, DenoConnByteStream, sql } from "jsr:@asla/pg";

const tcp = await Deno.connect({ hostname: "127.0.0.1", port: 5432 });
await using connection = await connectFromStream(new DenoConnByteStream(tcp), {
  user: "postgres",
  database: "app",
  password: () => Deno.env.get("PGPASSWORD") ?? "",
});

const row = await connection.query(sql`SELECT ${42}::int4 AS value`).getFirstRow();
console.log(row);
```

### Node.js 连接与 TLS

```ts
import { connect as connectTcp } from "node:net";
import { connect as connectTls } from "node:tls";
import { connectFromStream, NodeDuplexByteStream } from "jsr:@asla/pg";

const socket = connectTcp({ host: "127.0.0.1", port: 5432 });
await using connection = await connectFromStream(new NodeDuplexByteStream(socket), {
  user: "postgres",
  database: "app",
  password: process.env.PGPASSWORD,
  tls: {
    mode: "require",
    upgrade: () => new NodeDuplexByteStream(connectTls({ socket, servername: "localhost" })),
  },
});
```

`tls.mode` 可为 `disable`、`prefer` 或 `require`。TLS 证书校验由传入的 `upgrade`
回调负责；认证或协议失败后应丢弃该底层流。

### 查询、游标与 COPY

```ts
const rows = await connection.query("SELECT id, name FROM users").getRows();

await using cursor = connection.openCursor<{ id: number }>("SELECT id FROM users", {
  iteratorMaxRows: 100,
});
for await (const row of cursor) console.log(row);

const input = connection.copyFrom("COPY users(name) FROM STDIN");
await input.write(new TextEncoder().encode("Ada\nGrace\n"));
console.log(await input.closeWrite());

for await (const chunk of connection.copyTo("COPY users TO STDOUT")) {
  await Deno.stdout.write(chunk);
}
```

同一连接上的操作按调用顺序执行。SQL 错误会排空到 `ReadyForQuery` 后再把错误交给调用方，
因此连接通常可以复用；网络错误或协议错误会使连接不可复用。提前结束简单查询迭代或取消 COPY OUT
时，实现仍会排空当前查询周期。`copyForm()` 暂时保留为 `copyFrom()` 的废弃别名。

迁移细节见 [迁移到原生协议 API](docs/migration-native-protocol.md)。

## 核心能力

- 单连接查询：`createDbConnection()`
- 连接池查询：`PgDbQueryPool`
- 查询辅助方法：`queryRows()`、`queryFirstRow()`、`queryCount()`、`queryMap()`
- 事务：`begin()`、`commit()`、`rollback()`、`savePoint()`
- 游标：`cursor()`、异步迭代、按批读取
- 数据库管理：`DbManage`
- 执行 SQL 文件：`execSqlFile()`
- 连接串解析：`parserDbConnectUrl()`

## 快速开始

### 单连接

```ts
import { createDbConnection } from "jsr:@asla/pg";

await using db = await createDbConnection("postgres://postgres:password@127.0.0.1:5432/app");

const rows = await db.queryRows<{ id: number; name: string }>(
  "SELECT id, name FROM users ORDER BY id LIMIT 10",
);

const firstUser = await db.queryFirstRow<{ id: number; name: string }>(
  "SELECT id, name FROM users WHERE id = 1",
);

const affected = await db.queryCount("UPDATE users SET active = true WHERE id = 1");
```

### 连接池

```ts
import { PgDbQueryPool } from "jsr:@asla/pg";

await using pool = new PgDbQueryPool("postgres://postgres:password@127.0.0.1:5432/app");

const rows = await pool.queryRows<{ id: number; name: string }>(
  "SELECT id, name FROM users ORDER BY id LIMIT 10",
);
```

也可以传入对象形式的连接参数：

```ts
const pool = new PgDbQueryPool({
  database: "app",
  hostname: "127.0.0.1",
  port: 5432,
  user: "postgres",
  password: "password",
});
```

## 查询输入类型

库中的查询方法接受以下输入：

- `string`
- 带 `genSql()` 方法的对象
- 形如 `SqlTemplate` 的 SQL 模板对象
- 返回上述类型的函数
- 多语句场景下可传数组或返回数组的函数

单语句查询建议使用 `query()`、`queryRows()` 等方法；多语句查询建议使用 `query([sql1, sql2])`。`multipleQuery()`
仍可用，但已不推荐继续扩展新调用场景。

## 查询辅助方法

### `query()`

返回原始查询结果：

```ts
const result = await pool.query<{ id: number }>("SELECT id FROM users");
console.log(result.rowCount, result.rows);
```

### `queryRows()`

只返回 `rows`：

```ts
const rows = await pool.queryRows<{ id: number }>("SELECT id FROM users");
```

### `queryFirstRow()`

只返回第一行；如果没有结果会抛错：

```ts
const row = await pool.queryFirstRow<{ id: number }>("SELECT id FROM users LIMIT 1");
```

### `queryCount()`

返回受影响行数：

```ts
const count = await pool.queryCount("DELETE FROM users WHERE deleted_at IS NOT NULL");
```

### `queryMap()`

按指定字段生成 `Map`：

```ts
const userMap = await pool.queryMap<{ id: number; name: string }, "id">(
  "SELECT id, name FROM users",
  "id",
);
```

## 连接池与资源释放

### 普通连接

```ts
const conn = await pool.connect();
try {
  await conn.queryRows("SELECT 1");
} finally {
  conn.release();
}
```

更推荐使用 `using` 自动释放：

```ts
using conn = await pool.connect();
await conn.queryRows("SELECT 1");
```

行为说明：

- `release()` 后继续查询会抛出 `ConnectionNotAvailableError`
- 单次查询报错不会直接销毁连接对象，连接仍可继续执行后续语句
- `begin()` 创建事务对象时不会立刻占用连接，首次执行语句时才会真正建立连接

## 事务

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

## 游标

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

## 可等待 SQL 对象

`DbQueryPool` 提供两个便于组合调用的对象工厂：

### `createExecutableSQL()`

对象可直接 `await`，执行后返回 `void`：

```ts
const sql = pool.createExecutableSQL("DELETE FROM temp_data");
await sql;
```

### `createQueryableSQL()`

对象既可 `await`，也可继续链式调用查询辅助方法：

```ts
const users = pool.createQueryableSQL<{ id: number; name: string }>(
  "SELECT id, name FROM users ORDER BY id",
);

console.log(users.genSql());
const rows = await users.queryRows();
```

如果需要自定义 `await` 的结果，可以传入 `transform`：

```ts
const total = await pool.createQueryableSQL(
  "SELECT id FROM users",
  async (queryable, statement) => {
    return await queryable.queryCount(statement);
  },
);
```

## 工具函数

### 解析连接串

```ts
import { parserDbConnectUrl } from "jsr:@asla/pg";

const option = parserDbConnectUrl("postgres://postgres:password@127.0.0.1:5432/app");
```

### 执行 SQL 文件

```ts
import { createDbConnection, execSqlFile } from "jsr:@asla/pg";

await using db = await createDbConnection("postgres://postgres:password@127.0.0.1:5432/app");
await execSqlFile("./migrations/init.sql", db);
```

### 管理测试或临时数据库

```ts
import { DbManage } from "jsr:@asla/pg";

await using manage = await DbManage.connect("postgres://postgres:password@127.0.0.1:5432/postgres");
await manage.recreateDb("app_test");
```

## 开发与测试

安装依赖后，可直接使用 Deno task：

```sh
deno task type:check
deno task ci:test
```

集成测试依赖环境变量 `TEST_LOGIN_DB`，它应该指向一个有权限创建和删除数据库的 PostgreSQL 登录库，例如：

```sh
export TEST_LOGIN_DB='postgres://postgres:password@127.0.0.1:5432/postgres'
deno task ci:test
```

测试会为每个 worker 创建临时数据库，并在结束后自动清理。

## 抽象类扩展

如果你要对接其它驱动，可以基于抽象类实现自己的适配层：

- `DbQuery`：最小查询抽象
- `DbQueryPool`：连接池抽象
- `DbConnection` / `DbPoolConnection` / `DbTransaction`：连接与事务接口

示意：

```ts
import {
  DbQuery,
  type MultipleQueryInput,
  type MultipleQueryResult,
  type QueryDataInput,
  type QueryInput,
  type QueryRowsResult,
} from "jsr:@asla/pg";

class YourQuery extends DbQuery {
  execute(sql: QueryInput | MultipleQueryInput): Promise<void> {
    throw new Error("implement me");
  }

  query<T extends MultipleQueryResult = MultipleQueryResult>(sql: MultipleQueryInput): Promise<T>;
  query<T = unknown>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  query<T = unknown>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  query<T = unknown>(sql: QueryInput | MultipleQueryInput): Promise<any> {
    throw new Error("implement me");
  }

  multipleQuery<T extends MultipleQueryResult = MultipleQueryResult>(sql: string | string[]): Promise<T> {
    throw new Error("implement me");
  }
}
```
