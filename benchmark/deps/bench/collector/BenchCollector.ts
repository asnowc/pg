import { ConcurrencyBenchResultWithCPUAndMemory, ConcurrencyBenchSample } from "../types/bench_result.ts";
import { openFileCollector, readFileSamples, writeFileResult, writeFileSamples } from "./file_collector.ts";
import fs from "node:fs/promises";
function replaceName(name: string) {
  return name.replace(/[\s\/\\:]/g, "_");
}
export class BenchCollector {
  constructor(private dir: string) {
  }
  async ensureDirsExist() {
    await fs.mkdir(this.dir);
  }
  private getResultFilePath(name: string) {
    return `${this.dir}/${replaceName(name)}.result.json`;
  }
  private getSampleFilePath(name: string) {
    return `${this.dir}/${replaceName(name)}.sample.bin`;
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
  saveBenchResult(name: string, data: ConcurrencyBenchResultWithCPUAndMemory) {
    return writeFileResult(this.getResultFilePath(name), data);
  }
  async getBenchResult(name: string): Promise<ConcurrencyBenchResultWithCPUAndMemory> {
    const data = await fs.readFile(this.getResultFilePath(name), { encoding: "utf8" });
    return JSON.parse(data) as ConcurrencyBenchResultWithCPUAndMemory;
  }
}
