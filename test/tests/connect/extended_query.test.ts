import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("扩展查询编码参数并解码 NULL", async ({ connect }) => {
  const query = connect.query<{ value: number; nullable: string | null }>({
    sqlTemplate: "SELECT $1::int AS value, $2::text AS nullable",
    argsFormat: 0,
    args: ["42", ""],
  });
  await expect(query.getFirstRow()).resolves.toEqual({ value: 42, nullable: "" });
});

test("reader 只能消费一次", async ({ connect }) => {
  const query = connect.query<{ value: number }>("SELECT 1::int AS value");
  await expect(query.getRows()).resolves.toEqual([{ value: 1 }]);
  await expect(query.getRows()).rejects.toThrow();
});

test("并发扩展查询按各自操作归属结果", async ({ connect }) => {
  const [slow, fast] = await Promise.all([
    connect.query<{ value: number }>("SELECT 1::int AS value FROM pg_sleep(0.05)").getFirstRow(),
    connect.query<{ value: number }>("SELECT 2::int AS value").getFirstRow(),
  ]);
  expect(slow).toEqual({ value: 1 });
  expect(fast).toEqual({ value: 2 });
});
