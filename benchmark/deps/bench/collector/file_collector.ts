import fs from "node:fs/promises";
import path from "node:path";
import { clearImmediate, setImmediate } from "node:timers";
import type { ConcurrencyBenchSample } from "../types/sample.ts";
import type { ConcurrencyBenchResultWithCPUAndMemory } from "../types/bench_result.ts";

const RECORD_SIZE = 25;
const CHUNK_SIZE = RECORD_SIZE * 2048;
const HEADER = Uint8Array.of(80, 71, 66, 83, 1, 25, 0, 0);

export type FileCollectorOptions = {
  /** 包括正在写入的块；默认 8 MiB，满额时 push 抛错，不等待磁盘。 */
  maxBufferedBytes?: number;
};

export type StoredBenchResult = {
  schemaVersion: 1;
  sampleCount: number;
  metadata: Record<string, unknown>;
  result: ConcurrencyBenchResultWithCPUAndMemory;
};

function validSample(sample: ConcurrencyBenchSample) {
  return Number.isFinite(sample[0]) && sample[0] >= 0 &&
    Number.isFinite(sample[1]) && sample[1] >= sample[0] &&
    typeof sample[2] === "boolean" && Number.isSafeInteger(sample[3]) && sample[3] >= 0;
}

function paths(dir: string, name: string) {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new Error("Invalid sample file name");
  return { samples: path.join(dir, `${name}.samples.bin`), result: path.join(dir, `${name}.result.json`) };
}

async function writeAll(fd: fs.FileHandle, data: Uint8Array) {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await fd.write(data, offset, data.byteLength - offset);
    if (bytesWritten <= 0) throw new Error("Sample file write made no progress");
    offset += bytesWritten;
  }
}

class FileCollector {
  private buffer?: Uint8Array;
  private used = 0;
  private allocated = 0;
  private queue = Promise.resolve();
  private flushTimer?: ReturnType<typeof setImmediate>;
  private failure?: Error;
  private writeFailure?: Error;
  private closing?: Promise<void>;
  length = 0;

  constructor(
    private readonly fd: fs.FileHandle,
    private readonly dir: string,
    private readonly name: string,
    private readonly capacity: number,
  ) {}

  push(data: ConcurrencyBenchSample): void {
    if (this.closing) throw new Error("FileCollector is closed");
    if (this.failure) throw this.failure;
    if (!this.buffer) {
      const size = Math.floor(Math.min(CHUNK_SIZE, this.capacity - this.allocated) / RECORD_SIZE) * RECORD_SIZE;
      if (size < RECORD_SIZE) {
        this.failure = new Error(`Sample buffer reached maxBufferedBytes (${this.capacity}); sampling is incomplete`);
        throw this.failure;
      }
      this.buffer = new Uint8Array(size);
      this.allocated += size;
    }
    const view = new DataView(this.buffer.buffer, this.buffer.byteOffset + this.used, RECORD_SIZE);
    view.setFloat64(0, data[0], true);
    view.setFloat64(8, data[1], true);
    view.setUint8(16, data[2] ? 1 : 0);
    view.setFloat64(17, data[3], true);
    this.used += RECORD_SIZE;
    this.length++;
    if (this.used === this.buffer.byteLength) this.enqueue();
    else if (this.flushTimer === undefined) {
      this.flushTimer = setImmediate(() => {
        this.flushTimer = undefined;
        this.enqueue();
      });
    }
  }

  private enqueue() {
    if (this.flushTimer !== undefined) {
      clearImmediate(this.flushTimer);
      this.flushTimer = undefined;
    }
    if (!this.buffer) return;
    const buffer = this.buffer;
    const data = buffer.subarray(0, this.used);
    this.buffer = undefined;
    this.used = 0;
    this.queue = this.queue.then(async () => {
      try {
        if (!this.writeFailure) await writeAll(this.fd, data);
      } catch (error) {
        this.writeFailure = error instanceof Error ? error : new Error(String(error));
        this.failure ??= this.writeFailure;
      } finally {
        this.allocated -= buffer.byteLength;
      }
    });
  }

  async flush(): Promise<void> {
    this.enqueue();
    await this.queue;
    if (this.failure) throw this.failure;
  }

  async saveResult(
    result: ConcurrencyBenchResultWithCPUAndMemory,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.flush();
    const record: StoredBenchResult = {
      schemaVersion: 1,
      sampleCount: this.length,
      metadata,
      result,
    };
    await fs.writeFile(paths(this.dir, this.name).result, JSON.stringify(record, null, 2));
  }

  async read(): Promise<ConcurrencyBenchSample[]> {
    await this.flush();
    return readFileSamples(this.dir, this.name);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<ConcurrencyBenchSample> {
    await this.flush();
    yield* iterateFileSamples(this.dir, this.name);
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        await this.flush();
      } finally {
        await this.fd.close();
      }
    })();
    return this.closing;
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

/**
 * 新建 name.samples.bin；同名文件已存在时拒绝覆盖。调用方负责 await close/dispose。
 */
export async function openFileCollector(dir: string, name: string, options: FileCollectorOptions = {}) {
  const capacity = options.maxBufferedBytes ?? 8 * 1024 ** 2;
  if (!Number.isSafeInteger(capacity) || capacity < RECORD_SIZE) throw new RangeError("Invalid maxBufferedBytes");
  const file = paths(dir, name).samples;
  await fs.mkdir(dir, { recursive: true });
  const fd = await fs.open(file, "wx+");
  try {
    await writeAll(fd, HEADER);
    return new FileCollector(fd, dir, name, capacity);
  } catch (error) {
    await fd.close();
    throw error;
  }
}

/** 只读，不创建或修改原始文件；损坏或截断时抛错。 */
export async function* iterateFileSamples(dir: string, name: string): AsyncGenerator<ConcurrencyBenchSample> {
  const fd = await fs.open(paths(dir, name).samples, "r");
  try {
    const header = new Uint8Array(HEADER.length);
    let read = 0;
    while (read < header.length) {
      const { bytesRead } = await fd.read(header, read, header.length - read);
      if (!bytesRead) throw new Error("Truncated sample header");
      read += bytesRead;
    }
    if (!HEADER.every((value, i) => value === header[i])) throw new Error("Unsupported sample format");
    const buffer = new Uint8Array(CHUNK_SIZE);
    let remaining = 0;
    while (true) {
      const { bytesRead } = await fd.read(buffer, remaining, buffer.length - remaining);
      const available = remaining + bytesRead;
      if (bytesRead === 0) {
        if (remaining !== 0) throw new Error("Truncated sample record");
        break;
      }
      let offset = 0;
      while (offset + RECORD_SIZE <= available) {
        const view = new DataView(buffer.buffer, buffer.byteOffset + offset, RECORD_SIZE);
        const flag = view.getUint8(16);
        const sample: ConcurrencyBenchSample = [
          view.getFloat64(0, true),
          view.getFloat64(8, true),
          flag === 1,
          view.getFloat64(17, true),
        ];
        if (flag > 1 || !validSample(sample)) throw new Error("Invalid sample record");
        yield sample;
        offset += RECORD_SIZE;
      }
      remaining = available - offset;
      buffer.copyWithin(0, offset, available);
    }
  } finally {
    await fd.close();
  }
}

export async function readFileSamples(dir: string, name: string): Promise<ConcurrencyBenchSample[]> {
  const samples: ConcurrencyBenchSample[] = [];
  for await (const sample of iterateFileSamples(dir, name)) samples.push(sample);
  return samples;
}

export async function readFileResult(dir: string, name: string): Promise<StoredBenchResult> {
  const value: StoredBenchResult = JSON.parse(await fs.readFile(paths(dir, name).result, "utf8"));
  if (value.schemaVersion !== 1) throw new Error("Unsupported benchmark result version");
  return value;
}
