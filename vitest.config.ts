import { defineConfig } from "vitest/config";
import path from "node:path";
import deno from "@deno/vite-plugin";
const dirname = import.meta.dirname!;

export default defineConfig({
  plugins: [deno()],
  test: {
    alias: [
      { find: /^@asla\/pg/, replacement: path.join(dirname, "./src") + "/mod.ts" },
      { find: /^@\//, replacement: path.join(dirname, "./src") + "/" },
    ],
    setupFiles: ["./test/utils/setup.ts"],
  },
});
