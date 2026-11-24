import type { DataStream } from "@/_utils/DataStream.ts";
import { Duplex } from "node:stream";
import { NetConnBufferStream } from "./NetConnBufferStream.ts";
import { DuplexBufferStream } from "./DuplexAdapter.ts";
import { ConnectionSource } from "@/interface/Connection.ts";

export function createDataStream<T extends ConnectionSource>(source: T): DataStream {
  let stream: DataStream;
  if (source instanceof Duplex) {
    stream = new DuplexBufferStream(source);
  } else {
    stream = new NetConnBufferStream(source);
  }
  return stream;
}
