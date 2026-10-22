import { ConcurrencyBenchResultWithCPUAndMemory, ConcurrencyBenchSample } from "../types/bench_result.ts";
import { openFileCollector, readFileSamples, writeFileSamples } from "./SampleCollector.ts";
import fs from "node:fs/promises";

export class BenchCollector {
  static replaceName(name: string) {
    return name.replace(/[\s\/\\:]/g, "_");
  }
  constructor(private dir: string) {
  }
  async ensureDirsExist() {
    await fs.mkdir(this.dir);
  }
  private getResultFilePath(name: string) {
    return `${this.dir}/${BenchCollector.replaceName(name)}.result.json`;
  }
  private getSampleFilePath(name: string) {
    return `${this.dir}/${BenchCollector.replaceName(name)}.sample.bin`;
  }
  openSampleCollector(name: string) {
    return openFileCollector(this.getSampleFilePath(name));
  }
  saveSampleFile(name: string, samples: ConcurrencyBenchSample[]) {
    return writeFileSamples(this.getSampleFilePath(name), samples);
  }
  readSampleFile(name: string): Promise<ConcurrencyBenchSample[]> {
    return readFileSamples(this.getSampleFilePath(name));
  }

  async saveBenchResult(
    name: string,
    data: ConcurrencyBenchResultWithCPUAndMemory,
    metadata: Record<string, unknown> = {},
  ) {
    const filePath = this.getResultFilePath(name);
    const record: StoredBenchResult = { schemaVersion: 1, metadata, result: data };
    await fs.writeFile(filePath, JSON.stringify(record, null, 2));
  }
  async getBenchResult(name: string): Promise<StoredBenchResult> {
    const data = await fs.readFile(this.getResultFilePath(name), { encoding: "utf8" });
    return JSON.parse(data) as StoredBenchResult;
  }
}
export type StoredBenchResult = {
  schemaVersion: 1;
  metadata: Record<string, unknown>;
  result: ConcurrencyBenchResultWithCPUAndMemory;
};
