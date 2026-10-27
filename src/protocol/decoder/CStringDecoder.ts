import { StreamReader } from "@/_utils/StreamReader.ts";
import { concatU8ArrayList, StreamDecoder } from "./_common.ts";

const textDecoder = new TextDecoder();
export class CStringDecoder implements StreamDecoder<string> {
  private nameChunksSize = 0;
  private nameChunks: Uint8Array[] = [];
  next(reader: StreamReader) {
    let chunk = reader.buffer.subarray(reader.readableStart, reader.readableEnd);
    const index = chunk.indexOf(0);
    if (index === -1) {
      chunk = reader.buffer.slice(reader.readableStart, reader.readableEnd);
      this.nameChunks.push(chunk);
      this.nameChunksSize += chunk.byteLength;
      reader.readableStart += chunk.byteLength;
      return undefined;
    }
    if (this.nameChunksSize) {
      this.nameChunks.push(chunk.subarray(0, index));
      reader.readableStart += index + 1;
      chunk = concatU8ArrayList(this.nameChunks, this.nameChunksSize);
      this.nameChunks = [];
      this.nameChunksSize = 0;
    }
    return textDecoder.decode(chunk);
  }
  reset() {
    this.nameChunks = [];
    this.nameChunksSize = 0;
  }
}
