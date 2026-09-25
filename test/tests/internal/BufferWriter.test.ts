import { expect, test, vi } from "vitest";
import { BufferWriter } from "@/_utils/StreamWriter.ts";

function createWriter(size = 8, maxWrite = Infinity) {
  const output: number[] = [];
  const errors: unknown[] = [];
  const writer = new BufferWriter(
    new Uint8Array(size),
    async (buffer) => {
      const written = Math.min(buffer.byteLength, maxWrite);
      output.push(...buffer.subarray(0, written));
      return written;
    },
    (error) => errors.push(error),
  );
  return { writer, output, errors };
}

test("直接写入大块数据后继续写入，不丢失尾部", async () => {
  const { writer, output, errors } = createWriter();
  writer.pushData(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  writer.pushData(Uint8Array.of(11, 12, 13, 14));
  await vi.waitFor(() => expect(output).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]));
  expect(errors).toEqual([]);
});

test("缓冲的小块数据、异步生成数据与原地写入依序输出", async () => {
  const { writer, output, errors } = createWriter();
  writer.pushData(Uint8Array.of(1, 2));
  writer.pushWrite(async () => Uint8Array.of(3, 4, 5));
  writer.pushWriteInto((buffer, offset) => {
    if (buffer.byteLength - offset < 2) return null;
    buffer.set([6, 7], offset);
    return { written: 2, done: true };
  });
  writer.pushData(Uint8Array.of(8, 9, 10, 11));
  await vi.waitFor(() => expect(output).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]));
  expect(errors).toEqual([]);
});

test("底层短写时保留尚未写入的字节", async () => {
  const { writer, output, errors } = createWriter(8, 3);
  writer.pushData(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9));
  await vi.waitFor(() => expect(output).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]));
  expect(errors).toEqual([]);
});

test("队列空闲后冲刷小块数据", async () => {
  const { writer, output, errors } = createWriter();
  writer.pushData(Uint8Array.of(1, 2));
  await vi.waitFor(() => expect(output).toEqual([1, 2]));
  writer.pushData(Uint8Array.of(3));
  await vi.waitFor(() => expect(output).toEqual([1, 2, 3]));
  expect(errors).toEqual([]);
});

test("原地写入的缓冲区不足时报错", async () => {
  const { writer, errors } = createWriter(2);
  writer.pushWriteInto(() => null);
  await vi.waitFor(() => expect(errors).toHaveLength(1));
  expect(errors[0]).toEqual(new Error("Writer buffer is too small"));
});
test("原地写入在缓冲数据低于阈值时仍能推进", async () => {
  const output: number[] = [];
  const errors: unknown[] = [];
  let attempts = 0;
  const writer = new BufferWriter(
    new Uint8Array(8),
    async (buffer) => {
      output.push(...buffer);
      return buffer.byteLength;
    },
    (error) => errors.push(error),
  );

  writer.pushWriteInto((buffer, offset) => {
    if (attempts++ === 0) {
      buffer[0] = 1;
      return { written: 1, done: false };
    }
    if (attempts === 5) throw new Error("原地写入未能推进");
    if (offset !== 0) return null;
    buffer[0] = 2;
    return { written: 1, done: true };
  });

  await vi.waitFor(() => expect(output).toEqual([1, 2]));
  expect(errors).toEqual([]);
});
test("定时刷新不会与未完成的底层写入并发", async () => {
  const release: Array<() => void> = [];
  const errors: unknown[] = [];
  const writer = new BufferWriter(
    new Uint8Array(8),
    (_buffer) =>
      new Promise<number>((resolve) => {
        release.push(() => resolve(_buffer.byteLength));
      }),
    (error) => errors.push(error),
  );

  writer.pushWriteInto((buffer, offset) => {
    buffer.set([1, 2], offset);
    return { written: 2, done: true };
  });
  writer.pushData(Uint8Array.of(3, 4, 5, 6, 7, 8));

  try {
    await vi.waitFor(() => expect(release.length).toBeGreaterThanOrEqual(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(release).toHaveLength(1);
  } finally {
    release.forEach((resolve) => resolve());
  }
  expect(errors).toEqual([]);
});
