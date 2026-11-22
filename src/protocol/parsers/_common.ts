import { ReadableBuffer } from "@/_utils/ReadBuffer.ts";

export function skipData(reader: ReadableBuffer, remainingByteLength: number) {
  if (reader.readableLength < remainingByteLength) reader.readableStart = reader.readableEnd;
  else reader.readableStart += remainingByteLength;
}
