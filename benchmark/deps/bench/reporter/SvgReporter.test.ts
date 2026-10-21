import { afterEach, expect, test } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  analyzeSampleGroup,
  ConcurrencyBench,
  type ConcurrencyBenchSample,
  openFileCollector,
  readFileResult,
  readFileSamples,
  renderSvg,
} from "../../bench.ts";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test.skipIf("Deno" in globalThis)(
  "Node-only entry completes memory and disk sampling, analysis and SVG without a Deno global",
  async () => {
    expect("Deno" in globalThis).toBe(false);
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-bench-svg-"));
    directories.push(dir);
    const results = [];
    for (const mode of ["memory", "disk"]) {
      const samples: ConcurrencyBenchSample[] = [];
      const collector = mode === "disk" ? await openFileCollector(dir, mode) : undefined;
      try {
        const result = await new ConcurrencyBench({ name: mode, concurrency: [1, 2, 1], duration: 10 })
          .runWidthCpuAndMemory({
            fn: () => Promise.resolve(),
            intervalSampleCPUAndMemory: 5,
            collector: collector ?? samples,
          });
        if (collector) await collector.saveResult(result, { pid: process.pid });
        const raw = collector ? await readFileSamples(dir, mode) : samples;
        if (collector) expect((await readFileResult(dir, mode)).sampleCount).toBe(raw.length);
        results.push(analyzeSampleGroup({
          sampleGroup: {
            name: mode,
            startTime: result.intervalSampleData[0].timestamp,
            endTime: result.intervalSampleData.at(-1)!.timestamp,
            sampleCount: raw.length,
            samples: raw,
          },
          intervalSamples: result,
        }));
      } finally {
        await collector?.close();
      }
    }
    const file = path.join(dir, "comparison.svg");
    await renderSvg({ path: file, results });
    const svg = await fs.readFile(file, "utf8");
    expect(svg).toMatch(/^<svg\b/);
    for (
      const text of [
        "memory",
        "disk",
        "CPU",
        "Process RSS",
        "JS heap",
        "External memory",
        "Successful queries",
        "Target concurrency",
        "p99.9",
        "stage #3",
      ]
    ) {
      expect(svg).toContain(text);
    }
    expect(svg).not.toMatch(/NaN|Infinity/);
    expect(await fs.readdir(dir)).toEqual(["comparison.svg", "disk.result.json", "disk.samples.bin"]);
    await renderSvg({ path: path.join(dir, "single.svg"), ...results[0] });
    await expect(renderSvg({ path: dir, results })).rejects.toThrow();
  },
);

test("renders failure-only reports without pretending measurements exist", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-bench-failure-svg-"));
  directories.push(dir);
  const file = path.join(dir, "failure.svg");
  await renderSvg({ path: file, results: [], notes: ["broken: warmup failed", "missing client: file not found"] });
  const svg = await fs.readFile(file, "utf8");
  expect(svg).not.toContain("success=");
  expect(svg).toContain("warmup failed");
  expect(svg).toContain("missing client");
  expect(svg).not.toMatch(/NaN|Infinity/);
});
