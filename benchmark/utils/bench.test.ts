import { afterEach, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DEFAULT_BENCH_INPUT, loadQueryTargets, queryTarget, reportDirectory, runMemoryBench } from "./bench.ts";
import { readFileResult } from "../deps/bench.ts";

const directories: string[] = [];
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-bench-runner-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test("memory runner binds the connection, closes it, and writes SVG only", async () => {
  const dir = await directory();
  let closed = 0;
  const conn = { connected: true };
  const select = (value: typeof conn) => {
    expect(value).toBe(conn);
    return Promise.resolve();
  };
  await runMemoryBench({
    directory: dir,
    input: { concurrency: [1, 2], duration: 5 },
    queries: ["select"],
    targets: [queryTarget({
      name: "typed client",
      connect: () => Promise.resolve({ conn, pool: undefined }),
      close: () => {
        closed++;
        return Promise.resolve();
      },
      select,
      selectArg: select,
      selectArgs: select,
      selectWhere: select,
    })],
  });
  expect(closed).toBe(1);
  expect(await fs.readdir(dir)).toEqual(["select.svg"]);
  expect(DEFAULT_BENCH_INPUT).toEqual({ concurrency: [100, 250, 500], duration: 3000, warmupDuration: 1000 });
  expect(path.basename(reportDirectory("query"))).toMatch(/^query-\d{4}-/);
});

test("memory runner permits failures within budget and reports exceeded failures after cleanup", async () => {
  const dir = await directory();
  let closed = 0;
  let calls = 0;
  const target = {
    name: "errors",
    create: () =>
      Promise.resolve({
        query: () => {
          return ++calls === 1 ? Promise.reject(new Error("allowed")) : Promise.resolve();
        },
        close: () => {
          closed++;
          return Promise.resolve();
        },
      }),
  };
  await runMemoryBench({
    directory: dir,
    targets: [target],
    queries: ["select"],
    input: { concurrency: 1, duration: 5, maxFailures: 1 },
  });
  calls = 0;
  await expect(runMemoryBench({
    directory: dir,
    targets: [target],
    queries: ["selectArg"],
    input: { concurrency: 1, duration: 5 },
  })).rejects.toThrow("benchmark failures");
  expect(closed).toBe(2);
  expect(await fs.readdir(dir)).toEqual(["select.svg", "selectArg.svg"]);
});

test("missing previous artifact is an explicit error", async () => {
  try {
    await fs.access(new URL("../../dist/mod.js", import.meta.url));
  } catch {
    await expect(loadQueryTargets()).rejects.toThrow("previous version's dist/mod.js");
  }
});

test.each([false, true])(
  "fixed orchestration uses distinct client processes and reads their results (failure=%s)",
  async (fail) => {
    const dir = await directory();
    const fixture = fileURLToPath(new URL("../test/fixtures/bench-worker.ts", import.meta.url));
    const config = fileURLToPath(new URL("../deno.json", import.meta.url));
    const { stdout } = await promisify(execFile)("deno", [
      "run",
      "-A",
      "--frozen",
      "--config",
      config,
      fixture,
      dir,
      String(fail),
    ], { timeout: 20000 });
    expect(stdout).toContain(`failures=${fail ? 1 : 0}`);
    const second = await readFileResult(dir, "fake2");
    if (fail) {
      await expect(readFileResult(dir, "postgres")).rejects.toMatchObject({ code: "ENOENT" });
    } else {
      const first = await readFileResult(dir, "postgres");
      expect(first.metadata.pid).not.toBe(second.metadata.pid);
      expect(first.result.stageSamples.map((stage) => stage.concurrency)).toEqual([2, 1, 2]);
    }
    expect(second.result.stageSamples.map((stage) => stage.concurrency)).toEqual([2, 1, 2]);
    const files = await fs.readdir(dir);
    expect(files).toEqual([
      "comparison.svg",
      "fake2.result.json",
      "fake2.samples.bin",
      ...fail ? [] : ["postgres.result.json"],
      "postgres.samples.bin",
    ]);
    const svg = await fs.readFile(path.join(dir, "comparison.svg"), "utf8");
    expect(svg).toContain(fail ? "worker exited with code 1" : "postgres");
    expect(svg).toContain("fake2");
  },
);
