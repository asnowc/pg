import { describe, expect, expectTypeOf, test, vi } from "vitest";
import {
  createDbPoolConnection,
  DbQueryBase,
  DbQueryPool,
  ExecutableSQL,
  QueryableDataSQL,
  SqlStatementDataset,
} from "#abstract";
class MockQueryBase implements DbQueryBase {
  query = vi.fn(async (sql: any): Promise<any> => {});
  execute = vi.fn(async (sql: any): Promise<any> => {});
  multipleQuery = vi.fn();
}
class MockDbQueryPool extends DbQueryPool {
  idleCount = 0;
  totalCount = 0;
  connect = vi.fn(async () => createDbPoolConnection(new MockQueryBase(), () => {}));
  begin = vi.fn();
  cursor = vi.fn(async (): Promise<any> => {});
  query = vi.fn(async (): Promise<any> => ({ rowCount: 0, rows: [] }));
  execute = vi.fn(async (): Promise<any> => {});
  multipleQuery = vi.fn();
}
class SqlTextStatementDataset<T> implements SqlStatementDataset<T> {
  constructor(public sql: string) {}
  __infer(v: T): never {
    throw new Error("This method is only for type inference and should not be called");
  }
  genSql(): string {
    return this.sql;
  }
}

describe("DbQueryPool.createQueryableSQL", () => {
  test("genSql()", async () => {
    const pool = new MockDbQueryPool();

    const queryable = pool.createQueryableSQL("SELECT 1");

    expect(queryable.genSql()).toBe("SELECT 1");
  });
  test("should create queryable SQL with SqlStatementDataset", async () => {
    const pool = new MockDbQueryPool();
    const statement = new SqlTextStatementDataset<{ att: number }>("");

    const queryable = pool.createQueryableSQL(statement);
    expectTypeOf(queryable).toEqualTypeOf<QueryableDataSQL<{ att: number }, void>>();

    const res = await queryable;

    expectTypeOf(res).toBeVoid();
    expect(res).toBeUndefined();

    const res2 = await queryable.queryRows();
    expectTypeOf(res2).toEqualTypeOf<{ att: number }[]>();
    expect(pool.query).toHaveBeenCalledWith(statement);
  });

  test("设置 transform", async () => {
    const pool = new MockDbQueryPool();
    const statement = new SqlTextStatementDataset<{ att: number }>("SELECT 1 AS att");

    const queryable = pool.createQueryableSQL(statement, async (queryable, sqlLike) => {
      expectTypeOf(queryable).toEqualTypeOf<DbQueryPool>();
      expectTypeOf(sqlLike).toEqualTypeOf<SqlTextStatementDataset<{ att: number }>>();

      return 1;
    });
    const res = await queryable;
    expectTypeOf(res).toEqualTypeOf<number>();
    expect(res).toBe(1);
  });
});
describe("DbQueryPool.createExecutableSQL", () => {
  test("genSql()", async () => {
    const pool = new MockDbQueryPool();

    const queryable = pool.createExecutableSQL("SELECT 1");

    expect(queryable.genSql()).toBe("SELECT 1");
  });
  test("await 之后会调用 execute 并返回 void", async () => {
    const pool = new MockDbQueryPool();

    const queryable = pool.createExecutableSQL("SELECT 1");
    expectTypeOf(queryable).toEqualTypeOf<ExecutableSQL<void>>();

    const res = await queryable;

    expectTypeOf(res).toBeVoid();
    expect(res).toBeUndefined();
    expect(pool.execute).toHaveBeenCalledWith("SELECT 1");
  });
});
