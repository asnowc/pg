[![JSR version][jsr]][jsr-url]

[jsr]: https://jsr.io/badges/@asla/pg
[jsr-url]: https://jsr.io/@asla/pg

SQL 生成器

[API 文档](https://jsr.io/@asla/pg/doc)

## 抽象类

#### DbQuery 抽象类

```ts
class YourQuery extends DbQuery {
  execute(sql: QueryInput | MultipleQueryInput): Promise<void> {
    // implement
  }

  query<T extends MultipleQueryResult = MultipleQueryResult>(sql: MultipleQueryInput): Promise<T>;
  query<T = any>(sql: QueryDataInput<T>): Promise<QueryRowsResult<T>>;
  query<T = any>(sql: QueryInput): Promise<QueryRowsResult<T>>;
  query<T = any>(sql: QueryInput | MultipleQueryInput): Promise<QueryRowsResult<T>> {
    // implement
  }
  multipleQuery<T extends MultipleQueryResult = MultipleQueryResult>(sql: StringLike): Promise<T> {
    // implement
  }
  /**
   * 执行多语句的方法
   * @deprecated 不建议使用。改用 query()
   */
  abstract multipleQuery<T extends MultipleQueryResult = MultipleQueryResult>(sql: SqlLike | SqlLike[]): Promise<T>;
}
const db: DbQuery = new YourQuery();
```

```ts
declare const db: DbQuery;

type Row = { name: string; age: number };
const sqlText = "SELECT * FROM user";

const rows: Row[] = await db.queryRows<Row>(sqlText);
const count: number = await db.queryCount(sqlText);
const rows: Map<string, Row> = await db.queryMap<Row>(sqlText, "name");
```

#### DbQueryPool 抽象类

```ts
class YourPool extends DbQueryPool {
  // implement
}
const pool: DbQueryPool = new YourPool();
```

##### 普通查询

```ts
const conn = await pool.connect();
try {
  await conn.queryRows(sqlText);
} finally {
  conn.release();
}
```

或者，使用 `using` 语法更优雅 (推荐)

```ts
using conn = await pool.connect();
await conn.queryRows(sqlText);
```

##### 事务查询

```ts
const conn = pool.begin();
try {
  await conn.queryRows(sqlText);
  await conn.queryRows(sqlText);
  await conn.commit();
} catch (e) {
  await conn.rollback();
  throw e;
}
```

或者，使用 `using` 语法更优雅 (推荐)

```ts
await using conn = pool.begin();

await conn.queryRows(sqlText);
await conn.queryRows(sqlText);
await conn.commit();
```

##### 游标查询

```ts
const cursor = await pool.cursor(sqlText);

let rows = await cursor.read(20);
while (rows.length) {
  console.log(rows);
  rows = await cursor.read(20);
  if (conditions) {
    await cursor.close(); // 提前关闭游标
    break;
  }
}
```

或者使用 `for await of` 更优雅 (推荐)

```ts
const cursor = await pool.cursor(sqlText);
for await (const element of cursor) {
  console.log(element);
  if (conditions) break; //提前关闭游标
}
```
