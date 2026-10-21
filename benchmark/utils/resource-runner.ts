import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { PoolQueryTest } from "./common.ts";
import {
  type AnalyzedSampleGroup,
  analyzeSampleGroup,
  readFileResult,
  readFileSamples,
  renderSvg,
} from "../deps/bench.ts";

export const libraries = ["@asla/pg-node", "postgres", "@asla/pg", "fake2"] as const;
export async function loadLibrary(name: string, poolSize: number) {
  switch (name) {
    case "postgres":
      return loadTarget((await import("../client/postgres.ts")).poolQueryTest, poolSize);
      // case "fake":
      //   return loadTarget((await import("./fake.ts")).poolQueryTest, poolSize);
    case "fake2":
      return loadTarget((await import("../client/fake2.ts")).poolQueryTest, poolSize);
    case "@asla/pg": {
      const { initTest } = await import("./init-asla-pg-test.ts");
      return loadTarget(initTest(await import("@asla/pg")).poolQueryTest, poolSize);
    }
    case "@asla/pg-node": {
      const { initTest } = await import("./init-asla-pg-test.ts");
      return loadTarget(initTest(await import("@asla/pg"), name, true).poolQueryTest, poolSize);
    }
    default:
      throw new Error(`Unknown benchmark library: ${name}`);
  }
}
export type Library = typeof libraries[number];
export function integer(minimum: number) {
  return (value: string) => {
    const number = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < minimum) {
      throw new Error(`Expected a integer >= ${minimum}, received ${JSON.stringify(value)}`);
    }
    return number;
  };
}

export function filename(name: string): string {
  return name.replace(/^@/, "").replace(/[\\/]/g, "-");
}

async function loadTarget<T>(test: PoolQueryTest<T>, poolSize: number) {
  const pool = await test.createPool({ poolSize });
  return { query: () => test.select(pool), close: () => test.closePool(pool) };
}

export async function runResourceScenario(options: {
  directory: string;
  script: string;
  selected: readonly Library[];
  args: string[];
  description: string;
}): Promise<number> {
  const { directory, script, selected, args, description } = options;
  await Deno.mkdir(directory, { recursive: true });
  let failures = 0;
  const results: AnalyzedSampleGroup[] = [];
  const notes = ["Independent client processes; sampling and disk collection overhead included."];
  for (const name of selected) {
    console.log(`Running ${name}: ${description}`);
    try {
      const child = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "--frozen",
          "--no-prompt",
          "--config",
          fileURLToPath(new URL("../deno.json", import.meta.url)),
          fileURLToPath(script),
          ...args,
        ],
        env: { PG_BENCH_WORKER: name, PG_BENCH_OUTPUT: directory },
        stdin: "null",
        stdout: "inherit",
        stderr: "inherit",
      }).spawn();
      const status = await child.status;
      if (!status.success) {
        const message = `${name} worker exited with code ${status.code}`;
        failures++;
        console.error(message);
        notes.push(message);
        continue;
      }
      const stored = await readFileResult(directory, filename(name));
      const samples = await readFileSamples(directory, filename(name));
      if (samples.length !== stored.sampleCount) {
        throw new Error("Sample count does not match the recorded run");
      }
      const run = stored.result;
      if (run.name !== name) throw new Error("Result belongs to a different client");
      const analyzed = analyzeSampleGroup({
        sampleGroup: {
          name,
          startTime: run.intervalSampleData[0].timestamp,
          endTime: run.intervalSampleData.at(-1)!.timestamp,
          samples,
          sampleCount: samples.length,
        },
        intervalSamples: run,
      });
      results.push(analyzed);
      const failed = samples.filter((sample) => !sample[2]).length;
      console.log(`${name}: success=${samples.length - failed} failed=${failed}`);
    } catch (error) {
      failures++;
      const message = `${name}: ${String(error)}`;
      console.error(message);
      notes.push(message);
    }
  }
  await renderSvg({ path: resolve(directory, "comparison.svg"), title: description, results, notes });
  return failures;
}
