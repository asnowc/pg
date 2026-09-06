import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("SQL 错误排空到 ReadyForQuery 后连接可复用", async ({ connect }) => {
  await expect(connect.query("SELECT missing_column").getRows()).rejects.toThrow();
  await expect(connect.query<{ value: number }>("SELECT 1::int AS value").getFirstRow()).resolves.toEqual({ value: 1 });
});

test("重复 async dispose 幂等", async ({ connect }) => {
  await connect[Symbol.asyncDispose]();
  await connect[Symbol.asyncDispose]();
  expect(() => connect.query("SELECT 1")).toThrow();
});
