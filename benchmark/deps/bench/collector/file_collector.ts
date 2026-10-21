import fs from "node:fs/promises";
import path from "node:path";
import { ConcurrencyBenchSample } from "../types/sample.ts";

/** 流式数据收集器。二进制格式为 n 个 INT32 数数据  */
class FileCollector {
  constructor(private fd: fs.FileHandle, private dir: string, private name: string) {
    const tupleSize = 13;
    const buffer = new Uint8Array(tupleSize * 2);
    this.buffer = buffer;
    this.writeView = new DataView(buffer.buffer, buffer.byteOffset, tupleSize);
    this.readView = new DataView(buffer.buffer, buffer.byteOffset + tupleSize, tupleSize);
  }
  private buffer: Uint8Array;
  private writeView: DataView;
  private readView: DataView;
  private errored?: Error;
  length = 0;
  push(data: ConcurrencyBenchSample) {
    if (this.errored) {
      throw new Error("FileCollector encountered an error");
    }
    //TODO: 实现写队列，避免 buffer 被覆盖
    const view = this.writeView;
    view.setUint32(0, data[0]);
    view.setUint32(4, data[1]);
    view.setUint8(8, data[2] ? 1 : 0);
    view.setUint32(9, data[3]);
    this.fd.appendFile(view).then(() => {
      this.length++;
    }).catch((e) => {
      this.errored ??= e instanceof Error ? e : new Error(String(e));
    });
  }
  saveResult(result: any): Promise<void> {
    const filePath = path.join(this.dir, `${this.name}.result.json`);
    return fs.writeFile(filePath, JSON.stringify(result, null, 2));
  }
  async read(): Promise<ConcurrencyBenchSample[]> {
    throw new Error("Not implemented");
  }
  close(): Promise<void> {
    return this.fd.close();
  }
  [Symbol.asyncIterator]() {
    throw new Error("Not implemented");
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
/**
 * 目录约定：
 *  - dir
 *    - name.samples.bin
 *    - name.result.json
 */
export async function openFileCollector(dir: string, name: string): Promise<FileCollector> {
  await fs.mkdir(dir, { recursive: true });
  const fd = await fs.open(path.join(dir, `${name}.samples.bin`), "a+");
  return new FileCollector(fd, dir, name);
}
