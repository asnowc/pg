import { test } from "@test/fixtures/db_connect.ts";
import { expect } from "vitest";

test("简单查询跨事务查询", async ({ conn }) => {
  await conn.simpleQuery("BEGIN");
  await conn.simpleQuery("SELECT 1");
  await conn.simpleQuery("COMMIT");
});
test("禁止在事务中发起扩展查询", async ({ conn }) => {
  const q1 = await conn.simpleQuery("BEGIN");
  await expect(conn.query("SELECT 1")).rejects.toThrow();
});
test("单链接的查询状态是共享的", async ({ conn }) => {
  await conn.simpleQuery("BEGIN");
  await conn.query("SELECT 1");
  await conn.simpleQuery("COMMIT");
  await conn.query("BEGIN");
  await conn.query("SELECT 1");
  await conn.simpleQuery("COMMIT");
});
test("流水线扩展查询", async ({ conn }) => {
  const result = await Promise.allSettled([
    conn.query("SELECT 1"), //ok
    conn.query("SELECT 2"), //ok
    conn.query("SELECT 1/0"), //error
    conn.query("SELECT 3"), //error
  ]);
});
