# PgConnection 查询 API 设计草案

本文整理 `src/plan.ts` 中的 `PgConnection` 查询 API 草案，并记录当前设计可以继续明确或优化的地方。

## 1. 设计目标

`PgConnection` 表示一个已经完成认证的 PostgreSQL 连接，提供四种使用层次：

- `queryStream()`：暴露查询流，适合流式输入查询。
- `simpleQuery()`：执行简单查询，并以异步迭代方式取得一个或多个已编译结果。
- `query()`：提交查询后立即返回一个可等待、可迭代的 `QueryTask`。
- `openQuery()`：等待查询进入可读取状态后，返回带有字段、计数和游标控制能力的 `QueryHandle`。

整体思路是把“提交查询”和“消费结果”分开，使查询可以排队发送，并允许调用方选择一次性读取、逐行读取或分批读取。

## 2. 原始 API 整理

### 2.1 基础类型

```ts
type DataTypeParser<T> = (value: Uint8Array) => T;
type DataTypeParserMap = Map<number, DataTypeParser<any>>;

type RowParser<T> = (value: Uint8Array, field: FieldInfo) => T;
type RowParserMap = Map<number, RowParser<any>>;

type TypedQuery<T> = {};
type UnknownQuery = string | Uint8Array | Uint8Array[];

type Queryable<T> = TypedQuery<T> | UnknownQuery;
type SimpleQueryable = TypedQuery<unknown> | TypedQuery<unknown>[] | UnknownQuery;

type QueryOptions = {};
type CopyOption = {};

type FieldInfo = {
  index: number;
  name: string;
  typeId: number;
  typeSize: number;
  typeModifier: number;
};
```

### 2.2 连接和查询入口

```ts
declare class PgConnection {
  queryStream(): ReadableWritablePair<Uint8Array, QueryHandle<unknown>>;

  simpleQuery(
    queryable: SimpleQueryable,
    options?: QueryOptions,
  ): AsyncIterable<QueryHandle<unknown>>;

  simpleQuery(
    queryable: ReadableStream<Uint8Array>,
    options?: QueryOptions,
  ): AsyncIterable<QueryHandle<unknown>>;

  query<T>(queryable: Queryable<T>, options?: QueryOptions): QueryTask<T>;

  /** 返回的 Promise 在 CommandComplete 或 PortalSuspended 后 resolve。 */
  openQuery<T>(
    queryable: Queryable<T>,
    options?: OpenQueryOptions,
  ): Promise<QueryHandle<T>>;
}
```

### 2.3 结果读取接口

```ts
interface QueryReader<T> extends AsyncIterable<T> {
  getRows(limit?: number): Promise<T[]>;
  getFirstRow(): Promise<T | null>;
  batch(maxRows: number): AsyncIterableIterator<T[]>;
  getMap<Key>(key: string): Promise<Map<Key, T>>;

  [Symbol.asyncIterator](): AsyncIterableIterator<T>;
}

interface QueryHandle<T> extends QueryReader<T> {
  readonly rowCount: number;
  readonly fields: Map<string, FieldInfo>;
  readonly notices: string[];
  readonly cursorOffset: number;

  next(maxRows: number): Promise<T[]>;
  readonly isClosed: boolean;
  close(): void;
  [Symbol.dispose](): void;
}

interface QueryTask<T> extends QueryReader<T>, Promise<void> {
  getRowCount(): Promise<number>;
}
```

## 3. 使用方式

### 3.1 `query()`：提交后按需消费

```ts
const sql = "SELECT * FROM users";

const result = await conn.query(sql); // 忽略结果，只等待查询完成
const rowCount = await conn.query(sql).getRowCount(); // 只取得数量

const rows = await conn.query(sql).getRows(); // 读取所有行
const firstRows = await conn.query(sql).getRows(10); // 最多读取前 10 行
const firstRow = await conn.query(sql).getFirstRow(); // 读取第一行

for await (const row of conn.query(sql)) {
  console.log(row);
  break;
}
```

连续调用时，查询可以先进入队列，再通过最后一个查询触发完整的同步边界：

```ts
const results = await Promise.all([
  conn.query(sql),
  conn.query(sql).getRowCount(),
  conn.query(sql).getRows(),
  conn.query(sql).getFirstRow(),
]);
```

这里的“最后一条 SQL 后才发送 `Sync`”属于重要的批处理语义，实际实现时必须明确发送边界、错误归属和结果顺序。

### 3.2 `openQuery()`：显式控制结果生命周期

```ts
{
  using query = await conn.openQuery(sql);

  query.rowCount;
  query.fields;
  query.notices;

  const rows = await query.getRows();
  query.close();
}
```

也可以使用分批读取：

```ts
{
  using query = await conn.openQuery(sql);

  let items: any[];
  do {
    items = await query.next(10);
  } while (items.length > 0);
}
```

草案说明这些读取方法只能选择一种调用方式；这应当成为明确的运行时状态约束，而不只是示例注释。

## 4. 当前设计的主要优化点

### 4.1 明确 `rowCount` 的语义

`rowCount: number` 仍需明确具体含义，至少可能指：

- `SELECT` 返回的总行数；
- `INSERT`、`UPDATE`、`DELETE` 受影响的行数；
- 已经从当前 Portal 读取的行数；
- 当前批次返回的行数。

尤其是扩展查询在 `PortalSuspended` 时，服务端只表示本次执行暂时暂停，并不代表已经知道最终总数。因此建议区分：

```ts
interface QueryCommandResult {
  readonly commandTag: string;
  readonly rowCount: number | null;
}

interface QueryHandle<T> extends QueryReader<T>, AsyncDisposable {
  readonly result: QueryCommandResult;
  readonly fetchedCount: number;
  readonly hasMore: boolean;
}
```

如果 `rowCount` 仅代表最终 `CommandComplete` 中的数量，应允许 `null`。这也符合 PostgreSQL 驱动的常见语义：某些命令没有可用的行数。

### 4.2 修正 `openQuery()` 的 resolve 时机

注释规定 Promise 在 `CommandComplete` 或 `PortalSuspended` 后 resolve，但这两个事件的语义不同：

- `CommandComplete`：当前命令完成，可以取得最终命令结果。
- `PortalSuspended`：当前批次完成，但 Portal 仍可能有后续数据。

建议在 API 中显式表达状态，而不是让调用方从隐含行为猜测：

```ts
type QueryReadyState =
  | { type: "complete"; rowCount: number | null }
  | { type: "suspended"; hasMore: true };
```

或者将 API 拆成两个层次：普通 `query()` 等待完整结果，游标式 API 明确返回可继续读取的 Portal。

### 4.3 资源释放应使用异步生命周期

`QueryHandle.close(): void` 和 `[Symbol.dispose](): void` 对 PostgreSQL 协议来说可能过于乐观。关闭 Portal、发送 `Close`、等待响应、回收连接或处理取消请求，都可能需要异步操作。

仓库现有抽象已经偏向 `AsyncDisposable` 和 `await using`。因此更合适的契约是：

```ts
interface QueryHandle<T> extends QueryReader<T>, AsyncDisposable {
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

同时应定义以下行为：

- `getRows()` 或迭代器提前结束时是否自动关闭；
- `break` 离开 `for await` 后是否发送关闭或取消；
- 多次 `close()` 是否幂等；
- 查询出错后连接是否仍可复用；
- `next()` 在关闭后抛出哪一种错误。

### 4.4 避免 `QueryTask` 同时继承 Promise 和 AsyncIterable 的歧义

`QueryTask<T>` 同时是 Promise 和 AsyncIterable，使用方便，但会带来几个实现与语义问题：

- `await conn.query(sql)` 的结果是 `void`，调用方无法知道查询最终的命令结果；
- 查询究竟在 `query()` 调用时开始，还是第一次读取时开始，需要明确；
- 同一个对象被多个消费者同时读取时，是否允许并行；
- `getRows()`、`getRowCount()` 和迭代器之间的竞争关系难以从类型上表达；
- `Promise` 的 thenable 行为可能影响泛型推导和调试工具展示。

可以保留便捷 API，但建议内部使用一个明确的结果对象，并把入口区分为：

```ts
submit<T>(queryable: Queryable<T>, options?: QueryOptions): QueryTask<T>;
execute<T>(queryable: Queryable<T>, options?: QueryOptions): Promise<QuerySummary<T>>;
openQuery<T>(queryable: Queryable<T>, options?: OpenQueryOptions): Promise<QueryHandle<T>>;
```

如果继续保留 `QueryTask`，至少应把 `Promise` 的 resolve 类型从 `void` 改为一个轻量摘要，例如 `QuerySummary`，并在文档中规定只能有一个 active consumer。

### 4.5 统一 `getRows(limit)`、`batch()` 和 `next()` 的边界

当前三个接口都能读取数据，但边界规则尚未定义：

- `limit` 是否允许 `0`？
- `maxRows` 是否必须为正整数？
- `next()` 返回空数组后是否永久结束？
- `getRows(10)` 是只消费 10 行后关闭，还是只读取 10 行并保留 Portal？
- `batch(10)` 的最后一个批次是否可能为空数组？
- `getRows()` 是否会把所有数据缓存在内存中？

建议统一约定：正整数表示读取上限，`0` 拒绝；`getRows(limit)` 只适合有限结果集；`next(maxRows)` 返回空数组表示结束；流式读取应优先使用 `batch()` 或异步迭代器。

### 4.6 修正 `getFirstRow()` 的契约矛盾

接口返回 `Promise<T | null>`，表示没有行时返回 `null`；但草案注释又表示“如果返回多行，将抛出异常”。这可以实现，但需要说明读取策略：实现通常至少需要请求两行，才能判断结果是否超过一行。

建议写成明确契约：

```ts
/**
 * 返回唯一的一行。
 * 没有行时返回 null；超过一行时抛出 TooManyRowsError。
 */
getFirstRow(): Promise<T | null>;
```

如果实际需求只是“取第一行”，则应删除“多行抛错”的约定并改名为 `getFirstRow()` 的普通首行语义。

### 4.7 让 `TypedQuery<T>` 真正提供类型安全

```ts
type TypedQuery<T> = {};
```

空对象类型无法表达查询参数、结果字段、编码格式或 SQL 元数据，且容易使任意对象意外满足约束。建议引入品牌字段或公开构造函数，例如：

```ts
declare const typedQueryBrand: unique symbol;

type TypedQuery<T, Args extends readonly unknown[] = []> = {
  readonly [typedQueryBrand]: {
    readonly result: T;
    readonly args: Args;
  };
};
```

同时 `Queryable<T>` 最好把参数类型也带上：

```ts
type Queryable<T, Args extends readonly unknown[] = []> =
  | TypedQuery<T, Args>
  | string
  | Uint8Array;
```

### 4.8 明确 `UnknownQuery` 中字节数组的含义

`Uint8Array[]` 可能表示：

- 多条协议消息；
- 一个查询的分片；
- 多个 SQL 查询；
- 已编码的参数集合。

这几种含义的生命周期和错误处理完全不同。建议不要用同一个联合类型承载它们，改成有名字的输入类型，或使用对象区分：

```ts
type QueryInput =
  | { kind: "sql"; text: string }
  | { kind: "encoded"; bytes: Uint8Array }
  | { kind: "batch"; items: readonly QueryInput[] };
```

### 4.9 检查 `queryStream()` 的方向和抽象层级

`ReadableWritablePair<R, W>` 的第一个泛型是可读侧类型，第二个是可写侧类型。当前签名是：

```ts
queryStream(): ReadableWritablePair<Uint8Array, QueryHandle<unknown>>;
```

它表达为“从连接读出字节，并向连接写入 `QueryHandle`”。但从方法名和查询 API 推测，调用方可能期望写入查询输入、读出查询句柄。建议根据实际数据流方向重新命名泛型，必要时拆成两个明确的 `ReadableStream`/`WritableStream` API，避免把 PostgreSQL 协议字节和高层查询对象混在同一个 pair 中。

### 4.10 完善字段、解析器和通知的扩展点

`DataTypeParserMap`、`RowParserMap` 当前只是声明，没有连接到 `QueryOptions` 或 `PgConnection` 配置。建议明确优先级和作用范围：

- 解析器按连接、查询还是字段生效；
- 未注册 OID 时返回字符串、字节数组还是抛错；
- 二进制和文本格式如何选择；
- `RowParser` 是否能访问列名、类型修饰符和原始格式；
- `notices` 是查询完成后一次性读取，还是支持实时回调；
- 通知回调抛错时是否影响查询。

如果通知可能持续到查询结束以后，`notices: string[]` 还应改为快照或事件接口，避免调用方误以为它会实时更新。

### 4.11 统一错误、取消和并发规则

协议层至少需要定义以下错误和状态：

- SQL 执行错误；
- 查询被取消；
- Portal 已关闭；
- 连接断开；
- 查询结果尚未准备好；
- 同一个结果被并行读取；
- 无效的 `maxRows` 或重复关闭。

同时建议提供 `AbortSignal`：

```ts
interface QueryOptions {
  signal?: AbortSignal;
  parameters?: readonly unknown[];
  resultFormat?: "text" | "binary";
}
```

取消时要明确是发送 PostgreSQL `CancelRequest`，还是只停止本地消费。只停止本地消费而不清理服务端 Portal，可能使连接无法安全复用。

## 5. 推荐的收敛方向

第一阶段建议优先固定以下契约，再开始实现：

1. 将 `count` 改为语义明确的 `rowCount: number | null`，另加 `fetchedCount` 表示本地已读取数量。
2. 把 `QueryHandle` 改成 `AsyncDisposable`，让 `close()` 返回 `Promise<void>`，支持 `await using`。
3. 明确 `query()` 的单消费者约束、查询启动时机和提前 `break` 后的清理动作。
4. 将 `CommandComplete` 与 `PortalSuspended` 表达为不同状态，不再用同一个“已编译”状态掩盖两者差异。
5. 统一 `getRows`、`batch` 和 `next` 的 `maxRows`、结束和关闭语义。
6. 为 `TypedQuery<T>`、参数类型、字节输入和解析器注册方式补上真正的类型模型。
7. 为批量查询、协议错误、取消、提前关闭和多行 `getFirstRow()` 增加测试。

这样可以保留草案中“简单调用足够简单、复杂读取仍可控”的目标，同时让协议时序和资源生命周期不会被高层 API 的便利写法掩盖。
