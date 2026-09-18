import fs from "node:fs/promises";
import path from "node:path";
import type { ConcurrencyBenchSample } from "../types/bench_result.ts";

/** 单个写缓冲区容量 */
const BUFFER_SIZE = 1024 * 1024;
/**
 * 样本文件格式（大端）：
 * - 文件头 12 字节：uint32 precision（每毫秒的刻度数）+ uint64 timeOrigin（epoch 刻度）
 * - 记录 8 字节：uint32 start、uint32 end（相对 timeOrigin 的刻度）
 */
const HEADER_SIZE = 12;
const RECORD_SIZE = 8;
/** 待写入数据达到该长度时触发一次写入 */
const CHUNK_SIZE = 64 * 1024;

type SampleFileHeader = { timeOrigin: bigint; precision: number };
export type FileCollectorOptions = {
  /** epoch 刻度基准（毫秒乘以 precision），默认取 performance.timeOrigin；应使用默认值以匹配原始 performance.now()。 */
  timeOrigin?: bigint;
  /** 时间精度：每毫秒的刻度数，默认 1000（微秒）。 value/precision 的单位为毫秒。 */
  precision?: number;
};
function encodeHeaderInto(view: DataView, header: SampleFileHeader) {
  view.setUint32(0, header.precision, false);
  view.setBigUint64(4, header.timeOrigin, false);
}
function decodeHeader(bytes: Uint8Array): SampleFileHeader {
  const view = new DataView(bytes.buffer, bytes.byteOffset, HEADER_SIZE);
  return {
    precision: view.getUint32(0, false),
    timeOrigin: view.getBigUint64(4, false),
  };
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

/**
 * 把操作样本 `[startTime, endTime]` 以二进制流式写入一个样本文件（`<series>.sample.bin`）。
 * 由 {@link openFileCollector} 创建，`push` 只写入内存缓冲，累积到一定数量后异步写入磁盘；
 * 调用方必须 `await close()` 或使用 `await using`，否则末尾样本可能未写入。
 *
 * 样本文件格式（大端）：
 * - 文件头 12 字节：uint32 precision（每毫秒的刻度数，默认 1000）+ uint64 timeOrigin（epoch 刻度）
 * - 之后每条记录 8 字节：uint32 start、uint32 end，为 `performance.now()` 乘以 precision 后的刻度
 *
 * 一个基准测试结果目录（`benchDataDir`）包含：
 * - `manifest.json`：清单。记录测试名称、测试参数、meta、运行环境，以及已成功生成结果的系列；
 *   报告只包含清单中登记的系列。在所有系列运行结束后一次性写入
 * - `<series>.sample.bin`：该系列所有成功操作的样本，即本类写出的文件
 * - `<series>.result.json`：该系列的运行结果，包含各并发档位起止时间、成功/失败总数及 CPU/内存快照
 * - `<series>.report.json`：生成报告时缓存的分析结果，可删除后重新生成
 * - `report.svg`：所有系列的对比报告
 *
 * 其中 `<series>` 为系列名中的空白、`/`、`\`、`:` 替换为 `_` 后的文件名。
 */
export class SampleCollector {
  private current = new WriteBuffer();
  /** 当前缓冲区写满后暂存的样本字段，按 start、end 顺序排列。 */
  private retired: number[] = [];
  private retiredOffset = 0;
  private writing?: Promise<void>;
  private closing?: Promise<void>;
  /** 已接收的样本数 */
  length = 0;

  private precision: number;
  constructor(private readonly fd: fs.FileHandle, header: SampleFileHeader) {
    this.precision = header.precision;
    encodeHeaderInto(this.current.view, header);
    this.current.writeOffset = HEADER_SIZE;
  }
  private isWriteSlow: boolean = false;
  push(sample: ConcurrencyBenchSample): void {
    const { precision } = this;
    const start = Math.floor(sample[0] * precision);
    const end = Math.floor(sample[1] * precision);
    if (this.retiredOffset < this.retired.length || this.current.free < RECORD_SIZE) {
      if (!this.isWriteSlow) {
        this.isWriteSlow = true;
        console.warn("Write is slow, buffering samples in memory.");
      }
      this.retired.push(start, end);
    } else {
      const { view, writeOffset } = this.current;
      view.setUint32(writeOffset, start, false);
      view.setUint32(writeOffset + 4, end, false);
      this.current.writeOffset = writeOffset + RECORD_SIZE;
    }
    this.length++;

    if (this.retiredOffset < this.retired.length || this.current.pending >= CHUNK_SIZE) {
      this.scheduleWrite();
    }
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

  private appendRetired() {
    while (this.retiredOffset < this.retired.length && this.current.free >= RECORD_SIZE) {
      const { view, writeOffset } = this.current;
      view.setUint32(writeOffset, this.retired[this.retiredOffset], false);
      view.setUint32(writeOffset + 4, this.retired[this.retiredOffset + 1], false);
      this.current.writeOffset = writeOffset + RECORD_SIZE;
      this.retiredOffset += 2;
    }
    if (this.retiredOffset === this.retired.length) {
      this.retired.length = 0;
      this.retiredOffset = 0;
    }
  }

  /**
   * 把暂存样本按顺序追加到当前缓冲区；缓冲区需要腾出空间时先写盘，并在 await 后重新检查。
   */
  private async drain(threshold: number) {
    while (true) {
      const buffer = this.current;
      if (buffer.free < RECORD_SIZE && buffer.flushOffset > 0) buffer.compact();
      this.appendRetired();
      if (buffer.pending < threshold && buffer.free >= RECORD_SIZE) return;
      if (buffer.pending === 0) return;
      await this.write(buffer);
      if (buffer === this.current && buffer.flushOffset > 0) buffer.compact();
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

/** 顺序读取文件时间基准之后的样本时间；使用默认基准时与原始 performance.now() 坐标一致。文件截断时抛错。 */
export async function* iterateFileSamples(filePath: string): AsyncGenerator<ConcurrencyBenchSample> {
  const fd = await fs.open(filePath, "r");
  try {
    const headerBytes = new Uint8Array(HEADER_SIZE);
    if ((await fd.read(headerBytes, 0, HEADER_SIZE)).bytesRead !== HEADER_SIZE) {
      throw new Error("Truncated sample file header");
    }
    const { precision } = decodeHeader(headerBytes);

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
          view.getUint32(offset, false) / precision,
          view.getUint32(offset + 4, false) / precision,
        ];
      }
      buffer.copyWithin(0, offset, available);
      available -= offset;
    }
  } finally {
    await fd.close();
  }
}

/** 新建样本文件，已存在时拒绝覆盖。调用方负责 await close/dispose。 */
export async function openFileCollector(
  filePath: string,
  options: FileCollectorOptions = {},
): Promise<SampleCollector> {
  const precision = options.precision ?? 1000;
  const timeOrigin = options.timeOrigin ?? BigInt(Math.floor(performance.timeOrigin * precision));
  if (timeOrigin < 0) {
    throw new RangeError("timeOrigin must be a non-negative safe integer in epoch milliseconds");
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 0xFFFFFFFF) {
    throw new RangeError("precision must be an integer between 1 and 4294967295");
  }
  const header = { timeOrigin, precision };
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const fd = await fs.open(filePath, "wx");
  return new SampleCollector(fd, header);
}

/** 把内存中的样本写入新文件；读取后样本时间仍是原始 performance.now() 时间值。 */
export async function writeFileSamples(
  filePath: string,
  samples: ConcurrencyBenchSample[],
  options: Pick<FileCollectorOptions, "precision"> = {},
): Promise<void> {
  await using collector = await openFileCollector(filePath, options);
  for (const sample of samples) collector.push(sample);
}

export async function readFileSamples(filePath: string): Promise<ConcurrencyBenchSample[]> {
  const samples: ConcurrencyBenchSample[] = [];
  for await (const sample of iterateFileSamples(filePath)) samples.push(sample);
  return samples;
}
