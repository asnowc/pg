import { defineConfig } from "vitest/config";
import path from "node:path";
const dirname = import.meta.dirname!;

export default defineConfig({
  root: dirname,
  test: {
    environment: "node",
    include: ["deps/bench/**/*.test.ts", "utils/**/*.test.ts"],
    alias: [
      { find: "@asla/pg", replacement: path.join(dirname, "../src/mod.ts") },
      { find: "#abstract", replacement: path.join(dirname, "../src/abstract/mod.ts") },
      { find: /^@\//, replacement: path.join(dirname, "../src/") + "/" },
    ],
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});
