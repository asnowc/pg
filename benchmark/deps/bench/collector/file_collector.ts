import fs from "node:fs/promises";
import path from "node:path";
import type { ConcurrencyBenchResultWithCPUAndMemory, ConcurrencyBenchSample } from "../types/bench_result.ts";

/**
 * 样本文件格式（小端）：
 * - 文件头 12 字节：float64 baseTime（毫秒）+ uint32 precision（每毫秒的刻度数）
 * - 记录 12 字节：uint32 start、uint32 end（相对 baseTime 的刻度）、uint32 id
 */
const HEADER_SIZE = 12;
const RECORD_SIZE = 12;
/** 单个写缓冲区容量 */
const BUFFER_SIZE = 1024 * 1024;
/** 待写入数据达到该长度时触发一次写入 */
const CHUNK_SIZE = 64 * 1024;

type SampleFileHeader = { baseTime: number; precision: number };

function encodeHeader(header: SampleFileHeader) {
  const bytes = new Uint8Array(HEADER_SIZE);
  const view = new DataView(bytes.buffer);
  view.setFloat64(0, header.baseTime, true);
  view.setUint32(8, header.precision, true);
  return bytes;
}

function decodeHeader(bytes: Uint8Array): SampleFileHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  return { baseTime: view.getFloat64(0, true), precision: view.getUint32(8, true) };
}

/** 单个写缓冲区：[0, flushOffset) 已写入文件，[flushOffset, writeOffset) 等待写入。 */
class WriteBuffer {
  readonly bytes = new Uint8Array(BUFFER_SIZE);
  readonly view = new DataView(this.bytes.buffer);
  writeOffset = 0;
  flushOffset = 0;

  get pending() {
    return this.writeOffset - this.flushOffset;
  }
  get free() {
    return this.bytes.byteLength - this.writeOffset;
  }
  /** 把未写入数据移到开头。调用时不能有进行中的写入。 */
  compact() {
    this.bytes.copyWithin(0, this.flushOffset, this.writeOffset);
    this.writeOffset -= this.flushOffset;
    this.flushOffset = 0;
  }
}

export class FileCollector {
  private current = new WriteBuffer();
  /** 空间不足时被替换下来的缓冲区，写完后释放给 GC */
  private retired: WriteBuffer[] = [];
  private writing?: Promise<void>;
  private closing?: Promise<void>;
  /** 已接收的样本数 */
  length = 0;

  constructor(private readonly fd: fs.FileHandle, private readonly header: SampleFileHeader) {}

  push(sample: ConcurrencyBenchSample): void {
    if (this.current.free < RECORD_SIZE) {
      this.retired.push(this.current);
      this.current = new WriteBuffer();
    }
    const { view, writeOffset } = this.current;
    const { baseTime, precision } = this.header;
    view.setUint32(writeOffset, Math.floor((sample[0] - baseTime) * precision), true);
    view.setUint32(writeOffset + 4, Math.floor((sample[1] - baseTime) * precision), true);
    view.setUint32(writeOffset + 8, sample[2], true);
    this.current.writeOffset = writeOffset + RECORD_SIZE;
    this.length++;

    if (this.current.pending >= CHUNK_SIZE) this.scheduleWrite();
  }

  private scheduleWrite() {
    if (this.writing) return;
    this.writing = this.drain(CHUNK_SIZE).finally(() => {
      this.writing = undefined;
    });
  }

  private async write(buffer: WriteBuffer) {
    const { bytesWritten } = await this.fd.write(buffer.bytes, buffer.flushOffset, buffer.pending);
    buffer.flushOffset += bytesWritten;
  }

  /**
   * 先写完退役缓冲区，再按 threshold 写当前缓冲区；await 期间 push 可能替换当前缓冲区，
   * 因此每轮都重新检查。
   */
  private async drain(threshold: number) {
    while (true) {
      while (this.retired.length) {
        const buffer = this.retired[0];
        while (buffer.pending > 0) await this.write(buffer);
        this.retired.shift();
      }
      const buffer = this.current;
      if (buffer.pending < threshold) return;
      await this.write(buffer);
      if (buffer === this.current && buffer.flushOffset > buffer.free) buffer.compact();
    }
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      try {
        await this.writing;
        await this.drain(1);
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

export type FileCollectorOptions = {
  /** 样本时间的基准（毫秒），默认打开文件时的 performance.now()；样本时间不得早于它。 */
  baseTime?: number;
  /** 时间精度：每毫秒的刻度数，默认 1000（微秒）。 */
  precision?: number;
};

/** 新建样本文件，已存在时拒绝覆盖。调用方负责 await close/dispose。 */
export async function openFileCollector(filePath: string, options: FileCollectorOptions = {}): Promise<FileCollector> {
  const header = { baseTime: options.baseTime ?? performance.now(), precision: options.precision ?? 1000 };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const fd = await fs.open(filePath, "wx");
  await fd.write(encodeHeader(header));
  return new FileCollector(fd, header);
}

/** 顺序读取样本文件；文件截断时抛错。 */
export async function* iterateFileSamples(filePath: string): AsyncGenerator<ConcurrencyBenchSample> {
  const fd = await fs.open(filePath, "r");
  try {
    const headerBytes = new Uint8Array(HEADER_SIZE);
    if ((await fd.read(headerBytes, 0, HEADER_SIZE)).bytesRead !== HEADER_SIZE) {
      throw new Error("Truncated sample file header");
    }
    const { baseTime, precision } = decodeHeader(headerBytes);

    const buffer = new Uint8Array(CHUNK_SIZE);
    const view = new DataView(buffer.buffer);
    let available = 0;
    while (true) {
      const { bytesRead } = await fd.read(buffer, available, buffer.byteLength - available);
      if (bytesRead === 0) {
        if (available !== 0) throw new Error("Truncated sample record");
        return;
      }
      available += bytesRead;
      let offset = 0;
      for (; offset + RECORD_SIZE <= available; offset += RECORD_SIZE) {
        yield [
          baseTime + view.getUint32(offset, true) / precision,
          baseTime + view.getUint32(offset + 4, true) / precision,
          view.getUint32(offset + 8, true),
        ];
      }
      buffer.copyWithin(0, offset, available);
      available -= offset;
    }
  } finally {
    await fd.close();
  }
}

/** 把内存中的样本写入新文件，基准时间取最早的开始时间。 */
export async function writeFileSamples(
  filePath: string,
  samples: ConcurrencyBenchSample[],
  options: Pick<FileCollectorOptions, "precision"> = {},
): Promise<void> {
  let baseTime = Infinity;
  for (const sample of samples) baseTime = Math.min(baseTime, sample[0]);
  await using collector = await openFileCollector(filePath, { ...options, baseTime: samples.length ? baseTime : 0 });
  for (const sample of samples) collector.push(sample);
}

export async function readFileSamples(filePath: string): Promise<ConcurrencyBenchSample[]> {
  const samples: ConcurrencyBenchSample[] = [];
  for await (const sample of iterateFileSamples(filePath)) samples.push(sample);
  return samples;
}

export type StoredBenchResult = {
  schemaVersion: 1;
  metadata: Record<string, unknown>;
  result: ConcurrencyBenchResultWithCPUAndMemory;
};

export async function writeFileResult(
  filePath: string,
  result: ConcurrencyBenchResultWithCPUAndMemory,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const record: StoredBenchResult = { schemaVersion: 1, metadata, result };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(record, null, 2));
}

export async function readFileResult(filePath: string): Promise<StoredBenchResult> {
  const value: StoredBenchResult = JSON.parse(await fs.readFile(filePath, "utf8"));
  if (value.schemaVersion !== 1) throw new Error("Unsupported benchmark result version");
  return value;
}
