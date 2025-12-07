import { defineConfig } from "vitest/config";
import process from "node:process";
import path from "node:path";

const dirname = import.meta.dirname!;
const PG_URL = process.env.PG_URL || "pg://test@127.0.0.1:5432/postgres";

export default defineConfig({
  esbuild: { target: "es2025" },
  test: {
    alias: [
      { find: /^@asla\/pg/, replacement: path.join(dirname, "./src") + "/mod.ts" },
      { find: /^@\//, replacement: path.join(dirname, "./src") + "/" },
    ],
    env: {
      TEST_LOGIN_DB: PG_URL,
    },
  },
});
