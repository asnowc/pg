import { afterEach, expect, test, vi } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ConcurrencyBench, openFileCollector, readFileResult, readFileSamples } from "../../bench.ts";

const directories: string[] = [];
async function directory() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pg-bench-collector-"));
  directories.push(dir);
  return dir;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test("retains float precision and safe integer ids, flushes and supports iteration/read-only reopening", async () => {
  const dir = await directory();
  const collector = await openFileCollector(dir, "client");
  const samples = Array.from(
    { length: 5000 },
    (
      _,
      i,
    ): [number, number, boolean, number] => [
      i + 0.123456789,
      i + 0.987654321,
      i % 2 === 0,
      Number.MAX_SAFE_INTEGER - i,
    ],
  );
  for (const sample of samples) collector.push(sample);
  expect(await collector.read()).toEqual(samples);
  const iterated = [];
  for await (const sample of collector) iterated.push(sample);
  expect(iterated).toEqual(samples);
  await collector.close();
  await collector.close();
  expect(() => collector.push(samples[0])).toThrow("closed");
  const before = await fs.readFile(path.join(dir, "client.samples.bin"));
  expect(await readFileSamples(dir, "client")).toEqual(samples);
  expect(await fs.readFile(path.join(dir, "client.samples.bin"))).toEqual(before);
  await expect(openFileCollector(dir, "client")).rejects.toThrow();
});

test("buffer overflow throws without writing a successful result file", async () => {
  const dir = await directory();
  const collector = await openFileCollector(dir, "client", { maxBufferedBytes: 50 });
  collector.push([0, 1, true, 0]);
  collector.push([1, 2, true, 1]);
  expect(() => collector.push([2, 3, true, 2])).toThrow("maxBufferedBytes");
  const run = await new ConcurrencyBench({ concurrency: 1, duration: 1 }).runWidthCpuAndMemory({
    fn: () => Promise.resolve(),
    collector: [],
    intervalSampleCPUAndMemory: 10,
  });
  await expect(collector.saveResult(run)).rejects.toThrow("maxBufferedBytes");
  await expect(readFileResult(dir, "client")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(collector.close()).rejects.toThrow("maxBufferedBytes");
  expect(await readFileSamples(dir, "client")).toEqual([[0, 1, true, 0], [1, 2, true, 1]]);
});

test("detects invalid names, invalid capacity and truncated or unsupported files", async () => {
  const dir = await directory();
  await expect(openFileCollector(dir, "../bad")).rejects.toThrow("name");
  await expect(openFileCollector(dir, "client", { maxBufferedBytes: 24 })).rejects.toThrow();
  const collector = await openFileCollector(dir, "client");
  collector.push([0, 1, true, 0]);
  await collector.close();
  const file = path.join(dir, "client.samples.bin");
  await fs.truncate(file, 32);
  await expect(readFileSamples(dir, "client")).rejects.toThrow("Truncated");
  await fs.writeFile(file, new Uint8Array(8));
  await expect(readFileSamples(dir, "client")).rejects.toThrow("format");
});

test("rejects unsupported result versions", async () => {
  const dir = await directory();
  const collector = await openFileCollector(dir, "client");
  try {
    const result = await new ConcurrencyBench({ concurrency: 1, duration: 1 }).runWidthCpuAndMemory({
      fn: () => Promise.resolve(),
      collector,
      intervalSampleCPUAndMemory: 10,
    });
    await collector.saveResult(result);
    const stored = await readFileResult(dir, "client");
    await fs.writeFile(
      path.join(dir, "client.result.json"),
      JSON.stringify({
        ...stored,
        schemaVersion: 2,
      }),
    );
    await expect(readFileResult(dir, "client")).rejects.toThrow("version");
  } finally {
    await collector.close();
  }
});

test("serializes short writes and surfaces asynchronous write failures", async () => {
  const dir = await directory();
  const originalOpen = fs.open.bind(fs);
  let active = 0;
  let peak = 0;
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const originalWrite = handle.write.bind(handle);
    // Intercept the buffer overload used by the collector.
    vi.spyOn(handle, "write").mockImplementation(async (buffer, offset, length) => {
      peak = Math.max(peak, ++active);
      try {
        if (typeof buffer === "string" || typeof offset !== "number" || typeof length !== "number") {
          throw new Error("Unexpected write overload");
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
        return await originalWrite(buffer, offset, Math.min(7, length));
      } finally {
        active--;
      }
    });
    return handle;
  });
  const collector = await openFileCollector(dir, "short");
  collector.push([0.1, 1.2, true, 0]);
  await collector.close();
  expect(peak).toBe(1);
  expect(await readFileSamples(dir, "short")).toEqual([[0.1, 1.2, true, 0]]);
  vi.restoreAllMocks();
  vi.spyOn(fs, "open").mockImplementation(async (...args) => {
    const handle = await originalOpen(...args);
    const originalWrite = handle.write.bind(handle);
    let count = 0;
    vi.spyOn(handle, "write").mockImplementation((...writeArgs) => {
      if (++count > 1) return Promise.reject(new Error("disk failure"));
      return originalWrite(...writeArgs);
    });
    return handle;
  });
  const broken = await openFileCollector(dir, "broken");
  broken.push([0, 1, true, 0]);
  await expect(broken.flush()).rejects.toThrow("disk failure");
  expect(() => broken.push([0, 1, true, 1])).toThrow("disk failure");
  await expect(broken.close()).rejects.toThrow("disk failure");
});
