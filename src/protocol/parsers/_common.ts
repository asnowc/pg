import { ReadableBuffer } from "@/internal/ReadBuffer.ts";

export function skipData(reader: ReadableBuffer, remainingByteLength: number) {
  if (reader.readableLength < remainingByteLength) reader.readableStart = reader.readableEnd;
  else reader.readableStart += remainingByteLength;
}
