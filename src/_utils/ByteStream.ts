import type { AsyncReader, AsyncWriter } from "@/interface/ByteStream.ts";

const STREAM_MAX_READ_CHUNK_SIZE = 1024;

export async function readLength(stream: AsyncReader, length: number): Promise<Uint8Array> {
  const data = new Uint8Array(length);
  await readInto(stream, data);
  return data;
}

export async function readInto(
  stream: AsyncReader,
  data: Uint8Array,
  offset = 0,
  byteLength = data.byteLength - offset,
) {
  while (offset < byteLength) {
    const bytesRead = await stream.read(data.subarray(offset, offset + byteLength));
    if (bytesRead === null) throw new UnexpectedEOFError();
    offset += bytesRead;
  }
}

/** 数据完成写入后返回 */
export async function writeInto(stream: AsyncWriter, data: Uint8Array) {
  let offset = 0;
  while (offset < data.byteLength) {
    offset += await stream.write(data.subarray(offset));
  }
}
export async function skipData(stream: AsyncReader, length: number) {
  let remaining = length;
  if (remaining <= STREAM_MAX_READ_CHUNK_SIZE) {
    await readLength(stream, remaining);
    return;
  }
  let buffer = new Uint8Array(STREAM_MAX_READ_CHUNK_SIZE);
  while (remaining > 0) {
    const bytesRead = await stream.read(buffer);
    if (bytesRead === null) throw new UnexpectedEOFError();
    remaining -= bytesRead;
    if (remaining < STREAM_MAX_READ_CHUNK_SIZE) {
      buffer = buffer.subarray(0, remaining);
    }
  }
}
export class UnexpectedEOFError extends Error {
  constructor() {
    super("Unexpected end of file");
    this.name = "UnexpectedEOFError";
  }
}
