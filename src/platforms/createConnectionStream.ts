import type { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { Duplex } from "node:stream";
import { DenoConnBufferStream } from "./DenoConnAdapter.ts";
import { DuplexBufferStream } from "./DuplexAdapter.ts";
import { ConnectionSource } from "@/interface/Connection.ts";

export function createConnectionStream<T extends ConnectionSource>(source: T): ConnectionStream {
  let stream: ConnectionStream;
  if (source instanceof Duplex) {
    stream = new DuplexBufferStream(source);
  } else {
    stream = new DenoConnBufferStream(source);
  }
  return stream;
}
