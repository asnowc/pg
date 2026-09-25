import { QueryDecoder, StatementEncoder } from "@/interface/Query.ts";
import { BufferReader, StreamParser, StreamReader } from "@/_utils/StreamReader.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { MessageParser } from "./MessageParser.ts";

export class QueryQueue {
  readonly queue: ((writer: BufferWriter) => StreamParser<unknown>)[] = [];
  get length() {
    return this.queue.length;
  }
  dequeue() {
    return this.queue.shift();
  }
  onMessage(reader: StreamReader, type: number, bodyLength: number): StreamParser<unknown> {
  }

  extendedQuery(onQuery: (writer: BufferWriter) => StreamParser<unknown>) {
    this.queue.push(onQuery);
  }
  simpleQuery(onQuery: (writer: BufferWriter) => StreamParser<unknown>) {
    this.queue.push(onQuery);
  }
}
