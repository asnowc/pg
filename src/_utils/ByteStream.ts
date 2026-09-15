import type { ByteStream } from "@/interface/Connection.ts";

export async function disposeByteStreamData(stream: ByteStream, byteLength: number, maxChunk: number) {
  const totalLength = byteLength;
  const chunkSize = totalLength > maxChunk ? maxChunk : totalLength;
  const data = new Uint8Array(chunkSize);

  let nextRead: Uint8Array;
  do {
    nextRead = byteLength < chunkSize ? data.subarray(0, byteLength) : data;
    await stream.readInto(nextRead);
    byteLength -= nextRead.byteLength;
  } while (byteLength > 0);
}
