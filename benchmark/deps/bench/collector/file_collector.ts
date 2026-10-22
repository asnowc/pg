import fs from "node:fs/promises";
import path from "node:path";
import type { ConcurrencyBenchResultWithCPUAndMemory, ConcurrencyBenchSample } from "../types/bench_result.ts";

export type StoredBenchResult = {
  schemaVersion: 1;
  sampleCount: number;
  metadata: Record<string, unknown>;
  result: ConcurrencyBenchResultWithCPUAndMemory;
};

function validSample(sample: ConcurrencyBenchSample) {
  return Number.isFinite(sample[0]) && sample[0] >= 0 &&
    Number.isFinite(sample[1]) && sample[1] >= sample[0] && Number.isSafeInteger(sample[2]) && sample[2] >= 0;
}

function paths(dir: string, name: string) {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name)) throw new Error("Invalid sample file name");
  return { samples: path.join(dir, `${name}.samples.bin`), result: path.join(dir, `${name}.result.json`) };
}

async function writeAll(fd: fs.FileHandle, data: Uint8Array) {
  let offset = 0;
  while (offset < data.byteLength) {
    const { bytesWritten } = await fd.write(data, offset, data.byteLength - offset);
    offset += bytesWritten;
  }
}

const BUFFER_SIZE = 1 * 1024 * 1024;
const RECORD_SIZE = 13;
const CHUNK_SIZE = 8 * 1024;
class FileCollector {
  private buffer: Uint8Array = new Uint8Array(BUFFER_SIZE);
  private view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
  private writeOffset = 0;

  private closing?: Promise<void>;
  length = 0;

  constructor(
    private readonly fd: fs.FileHandle,
    private readonly dir: string,
    private readonly name: string,
    /** 时间精度。0 为毫秒，1000 为微秒 */
    private readonly precision: number,
  ) {}

  push(data: ConcurrencyBenchSample): void {
    if (this.closing) throw new Error("FileCollector is closed");

    const view = this.view;
    view.setUint32(this.writeOffset, floor(data[0], this.precision));
    this.writeOffset += 4;
    view.setUint32(this.writeOffset, floor(data[1], this.precision));
    this.writeOffset += 4;
    view.setUint32(this.writeOffset, data[2]);
    this.writeOffset += 4;

    const cacheLength = this.buffer.byteLength - this.writeOffset;
    if (cacheLength < RECORD_SIZE) {
      this.change();
    } else if (cacheLength > CHUNK_SIZE) {
      this.checkWrite();
    }
  }
  private change() {
    this.buffer = new Uint8Array(BUFFER_SIZE);
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);

    this.writeOffset = 0;
  }
  private writing: Promise<void> | undefined;
  private checkWrite() {
    if (this.writing) return;
    this.writing = this.startWrite().then(
      () => {
        this.writing = undefined;
      },
      () => {
        this.writing = undefined;
      },
    );
  }
  private async startWrite() {
    const buffer = this.buffer;
    const bufferSize = buffer.byteLength;
    let written = 0;
    while (this.writeOffset - written > CHUNK_SIZE) {
      const { bytesWritten } = await this.fd.write(buffer.subarray(written, this.writeOffset));
      written += bytesWritten;
      if (written > bufferSize - this.writeOffset) {
        buffer.copyWithin(0, written, this.writeOffset);
        this.writeOffset -= written;
        written = 0;
      }
    }
    if (written > 0) {
      buffer.copyWithin(0, written, this.writeOffset);
      this.writeOffset -= written;
      written = 0;
    }
  }

  async saveResult(
    result: ConcurrencyBenchResultWithCPUAndMemory,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    const record: StoredBenchResult = {
      schemaVersion: 1,
      sampleCount: this.length,
      metadata,
      result,
    };
    await fs.writeFile(paths(this.dir, this.name).result, JSON.stringify(record, null, 2));
  }
  private async flush() {
    let written = 0;
    while (written < this.writeOffset) {
      const { bytesWritten } = await this.fd.write(this.buffer.subarray(written, this.writeOffset));
      written += bytesWritten;
    }
  }
  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        await this.writing;
        if (this.writeOffset) await this.flush();
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
function floor(value: number, shift: number) {
  return Math.floor(value * shift);
}

/**
 * 新建 name.samples.bin；同名文件已存在时拒绝覆盖。调用方负责 await close/dispose。
 */
export async function openFileCollector(dir: string, name: string) {
  const file = paths(dir, name).samples;
  await fs.mkdir(dir, { recursive: true });
  const fd = await fs.open(file, "wx+");
  return new FileCollector(fd, dir, name, 1000);
}

/** 只读，不创建或修改原始文件；损坏或截断时抛错。 */
export async function* iterateFileSamples(dir: string, name: string): AsyncGenerator<ConcurrencyBenchSample> {
  const fd = await fs.open(paths(dir, name).samples, "r");
  const buffer = new Uint8Array(CHUNK_SIZE);
  try {
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
export async function writeFileSamples(path: string, samples: ConcurrencyBenchSample[]): Promise<void> {
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
