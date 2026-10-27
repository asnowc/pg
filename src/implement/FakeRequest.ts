import { PgAuthenticationExchangeOptions } from "@asla/pg";
import { startAuth } from "@/protocol/connect.ts";
import { BufferWriter, StreamWriter } from "@/_utils/StreamWriter.ts";
import { MessageParsers } from "@/protocol/parsers/MessageParser.ts";
import {
  BackendMessageCode,
  DescribeTarget,
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
  encodeTerminateMessage,
  FRAME,
} from "@/protocol.ts";
import { Buffer } from "node:buffer";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { eachLink, LinkList } from "@/_utils/LinkList.ts";
import { InternalTextSqlStatementEncoder } from "@/codec/StatementEncoder.ts";

export class FakeRequest {
  constructor(private connections: Conn[]) {
  }
  private count = 0;
  private getConn() {
    return this.connections[this.count++ % this.connections.length];
  }
  async query(data: string): Promise<any> {
    const conn = this.getConn();
    return conn.query(data);
  }
  async close() {
    for (const item of this.connections) {
      await item.close();
    }
  }
}
export async function getFakePool(
  options: PgAuthenticationExchangeOptions & { database: string; hostname: string; port: number },
  count: number,
) {
  const connections = await Promise.all(new Array(count).fill(0).map(() => connect(options)));
  return new FakeRequest(connections);
}
async function connect(
  options: PgAuthenticationExchangeOptions & { database: string; hostname: string; port: number },
) {
  const conn = await Deno.connect({
    hostname: options.hostname,
    port: options.port,
  });
  const info = await startAuth(conn, options);
  return new Conn(conn);
}
class Conn {
  writer: StreamWriter;
  constructor(private conn: Deno.Conn) {
    const flushThreshold = 8 * 1024;
    const buffer = new BufferWriter((data) => conn.write(data), flushThreshold * 2, flushThreshold);
    this.writer = new StreamWriter(buffer, () => conn.closeWrite(), (e) => {
      console.error("BufferWriter error", e);
    });
    const reader = new BufferReader(new Uint8Array(8 * 1024));
    const parsers = new MessageParsers(Infinity);
    (async () => {
      do {
        const bytesRead = await conn.read(reader.getIdleFreeReaderBuffer());
        if (bytesRead === null) {
          this.clear(new Error("Connection closed"));
          break;
        }
        if (bytesRead === 0) continue;
        reader.readerBufferWriteOffset += bytesRead;
        parsers.next(reader);
        reader.gc();
      } while (true);
    })();
    parsers.set(BackendMessageCode.CommandComplete, (reader) => {
      const item = this.#link.head;
      if (!item) {
        console.error("No item in link list for CommandComplete");
        return;
      }
      this.#link.shift();
      item.resolve(undefined);
    });
  }
  #link = new LinkList<{ resolve: (value: unknown) => void; reject: (reason?: any) => void }>();
  private clear(error: unknown) {
    for (const item of eachLink(this.#link.head)) {
      item.reject(error);
    }
    this.#link.clear();
  }
  query(data: string) {
    return new Promise((resolve, reject) => {
      this.#link.push({ resolve, reject });
      this.writer.pushData(getQueryData(data));
    });
  }
  async close() {
    this.writer.pushData(encodeTerminateMessage());
    return new Promise((resolve) => {
      setTimeout(() => {
        this.conn.closeWrite();
        this.conn.close();
        resolve(undefined);
      }, 100);
    });
  }
}
function getQueryData(textStatement: string) {
  const statement = new InternalTextSqlStatementEncoder(textStatement);
  const parse = encodeParseMessage(statement);
  const bind = encodeBindMessage(statement);
  const portal = encodeDescribeMessage(DescribeTarget.Portal);
  const execute = encodeExecuteMessage(0);
  const sync = FRAME.SYNC;
  const list = [parse, bind, portal, execute, sync];
  return Buffer.concat(list);
}
