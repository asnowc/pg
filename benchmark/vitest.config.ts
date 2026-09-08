import { defineConfig } from "vitest/config";
import path from "node:path";
import deno from "@deno/vite-plugin";
const dirname = import.meta.dirname!;

export default defineConfig({
  plugins: [deno()],
  test: {
    alias: [
      { find: "@asla/pg", replacement: path.join(dirname, "../dist/src/mod.ts") },
    ],
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
