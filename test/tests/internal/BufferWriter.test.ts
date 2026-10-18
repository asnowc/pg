import { expect, test, vi } from "vitest";
import { BufferWriter, StreamWriter } from "@/_utils/StreamWriter.ts";

function createWriter(size = 8, maxWrite = Infinity) {
  const output: number[] = [];
  const errors: unknown[] = [];
  const writer = new StreamWriter(
    new BufferWriter(async (buffer) => {
      const written = Math.min(buffer.byteLength, maxWrite);
      output.push(...buffer.subarray(0, written));
      return written;
    }, size),
    async () => {},
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

test("缓冲的小块数据与异步写入回调依序输出", async () => {
  const { writer, output, errors } = createWriter();
  writer.pushData(Uint8Array.of(1, 2));
  writer.pushWrite(async (writer) => writer.writeData(Uint8Array.of(3, 4, 5)));
  writer.pushWrite(async (writer) => writer.writeData(Uint8Array.of(6, 7)));
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

test("定时刷新不会与未完成的底层写入并发", async () => {
  const release: Array<() => void> = [];
  const errors: unknown[] = [];
  const writer = new StreamWriter(
    new BufferWriter(
      async (_buffer) =>
        new Promise<number>((resolve) => {
          release.push(() => resolve(_buffer.byteLength));
        }),
      8,
    ),
    async () => {},
    (error) => errors.push(error),
  );

  writer.pushWrite(async (writer) => writer.writeData(Uint8Array.of(1, 2)));
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
