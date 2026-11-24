import { defineConfig } from "rolldown";
export default defineConfig({
  input: "./src/mod.ts",
  output: {
    dir: "dist",
    chunkFileNames: "[name].js",
    cleanDir: true,
    preserveModules: true,
  },
});
