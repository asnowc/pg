import { StreamReader } from "@/_utils/StreamReader.ts";
import { PgFormat } from "../const.ts";
import { PgProtocolError } from "@/_utils/error.ts";

export interface StreamDecoder<T> {
  next(reader: StreamReader): T | undefined;
  reset(): void;
}
export interface MessageParser<T> {
  next(reader: StreamReader, remainingByteLength: number): T | undefined;
  reset(): void;
}
export function getFormat(format: number): PgFormat {
  if (format !== PgFormat.text && format !== PgFormat.binary) {
    throw new PgProtocolError(`Invalid PostgreSQL format code: ${format}`);
  }
  return format;
}
export function concatU8ArrayList(list: Uint8Array[], size: number) {
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of list) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}
