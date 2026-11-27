import type { DataStream } from "@/internal/DataStream.ts";
import { Duplex } from "node:stream";
import { NetConnBufferStream } from "@/internal/NetConnBufferStream.ts";
import { DuplexBufferStream } from "./node.ts";
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
