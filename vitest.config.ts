import { defineConfig, ViteUserConfigFnObject } from "vitest/config";
import process from "node:process";
import path from "node:path";
const dirname = import.meta.dirname!;
const PG_URL = process.env.PG_URL || "pg://test@127.0.0.1:5432/postgres";

type UserConfig = ReturnType<ViteUserConfigFnObject>;
export default defineConfig(async () => {
  const plugin: UserConfig["plugins"] = [];
  if ("Deno" in globalThis) {
    const { default: deno } = await import("@deno/vite-plugin");
    plugin.push(deno() as UserConfig["plugins"]);
  }
  return {
    esbuild: { target: "es2024" },
    plugins: plugin,
    test: {
      alias: [
        { find: /^@asla\/pg/, replacement: path.join(dirname, "./src") + "/mod.ts" },
        { find: /^@\//, replacement: path.join(dirname, "./src") + "/" },
      ],
      env: {
        TEST_LOGIN_DB: PG_URL,
      },
    },
  };
});
