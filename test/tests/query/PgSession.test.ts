import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";
import { NoDecoderError } from "@/_utils/error.ts";

test("不存在类型解析器时抛出异常", async ({ conn }) => {
  const sql = "SELECT 1";
  await expect(conn.query(sql, { typeDecoders: new Map() }).firstRow()).rejects.toThrow(NoDecoderError);
  await expect(conn.query(sql).rowCount(), "如果不读取结果则不会抛出异常").resolves.toBe(1);
});
test("查询匿名列", async ({ conn }) => {
  // 同名会被替换
  await expect(conn.query("SELECT 1, 2").firstRow()).resolves.toEqual({ "?column?": 2 });
});
