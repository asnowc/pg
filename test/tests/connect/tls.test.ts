import { expect } from "vitest";
import { test } from "@test/fixtures/db_connect.ts";

test("TLS fixture 使用受信 CA 并由服务端确认加密", async ({ tlsConnect }) => {
  const row = await tlsConnect.query<{ ssl: boolean; version: string }>(`
    SELECT ssl, version
    FROM pg_stat_ssl
    WHERE pid = pg_backend_pid()
  `).getFirstRow();
  expect(row?.ssl).toBe(true);
  expect(row?.version).toMatch(/^TLSv1\./);
});
