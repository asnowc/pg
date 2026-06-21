### 查询单行

当前通过 queryFirstRow 来查询第一行，如果返回结果行数不等于 1行，会抛出异常
更多场景是：查询预期返回0或1行，如果返回多行，应抛出错误

```ts
conn.queryFirstRow(); //只返回第一行。如果查询没有返回行，则抛出异常
```

期望做以下 API 调整:

```ts
interface DbQuery {
  /** 结果应返回 0 行或 1 行，如果返回超过一行，则应抛出异常 */
  queryRowIfExist<T>(): Promise<T | null>; // 命名待定
  /** 结果应 1 行，否则则应抛出异常 */
  queryRow<T>(): Promise<T>; // 命名待定

  // 废弃 queryFirstRow
}
```

### 多查询

当前通过 query 一个 sql 数组，结果返回一个很多信息的数组，实际值需要一次性查询多个数据，而无需获取太多信息

```ts
conn.query([]);
```

一个解决方案是返回一个查询对象，再通过查询对象进行二次操作

另一个需要解决的是，有时候需要获取多查询的某个信息, 或者说，每个查询的选项不一样，可以通过下面的查询处理：

```ts
const res = await conn.query([{
  key: "a",
  sql: "",
  //...
}, {
  key: "a",
  sql: "",
  //...
}]);

res.a.x;
```
