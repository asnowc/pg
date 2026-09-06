import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("简单查询返回多结果、NULL 和命令完成信息", async ({ connect }) => {
  const results = [];
  for await (
    const result of connect.simpleQuery(
      "SELECT 1::int AS value, NULL::text AS nullable; SELECT 'second'::text AS value",
    )
  ) results.push(result);

  expect(results).toHaveLength(2);
  expect(results[0].rows).toEqual([{ value: 1, nullable: null }]);
  expect(results[0].rowCount).toBe(1);
  expect(results[1].rows).toEqual([{ value: "second" }]);
});

test("空查询返回空结果且连接仍可复用", async ({ connect }) => {
  const empty = [];
  for await (const result of connect.simpleQuery(";")) empty.push(result);
  expect(empty).toHaveLength(1);

  const reused = [];
  for await (const result of connect.simpleQuery("SELECT 2::int AS value")) reused.push(...result.rows);
  expect(reused).toEqual([{ value: 2 }]);
});

test("提前结束结果迭代后连接可复用", async ({ connect }) => {
  for await (const _result of connect.simpleQuery("SELECT 1; SELECT 2")) break;

  const rows = [];
  for await (const result of connect.simpleQuery("SELECT 3::int AS value")) rows.push(...result.rows);
  expect(rows).toEqual([{ value: 3 }]);
});
