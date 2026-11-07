import { PgAuthenticationExchangeOptions } from "@asla/pg";
import { startAuth } from "@/protocol/connect.ts";
import { BufferWriter } from "@/_utils/BufferWriter.ts";
import { MessageParsers } from "@/protocol/parsers/MessageParser.ts";
import { BackendMessageCode, decodeError, FRAME } from "@/protocol.ts";
import { PgDatabaseError } from "@/error.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { eachLink, LinkList } from "@/_utils/LinkList.ts";
import { BufferWriterQueue } from "@/_utils/BufferWriterQueue.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { TerminateFrame } from "@/protocol/encoder/Message.ts";
import { ExecuteMessageEncoder, ParseMessageEncoder } from "@/protocol/encoder/ExtendedQuery.ts";

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
  writer: BufferWriterQueue;
  constructor(private conn: Deno.Conn) {
    const flushThreshold = 8 * 1024;
    const buffer = new BufferWriter((data) => conn.write(data), flushThreshold * 2, flushThreshold);
    this.writer = new BufferWriterQueue(buffer, () => conn.closeWrite(), (e) => {
      this.clear(e);
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
        reader.readableEnd += bytesRead;
        parsers.next(reader);
        reader.gc();
      } while (true);
    })().catch((error) => {
      this.clear(error);
      conn.close();
    });
    parsers.setFullParser(BackendMessageCode.ErrorResponse, (body) => {
      this.clear(new PgDatabaseError(decodeError(body).fields));
    });
    parsers.setFullParser(BackendMessageCode.CommandComplete, () => {
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
      const statement = new TypedSqlStatement(data);
      this.#link.push({ resolve, reject });
      getQueryData(statement, this.writer);
    });
  }
  close() {
    this.writer.pushEncoder(TerminateFrame);
    return this.writer.pushClose();
  }
}
function getQueryData(statement: TypedSqlStatement, writer: BufferWriterQueue) {
  writer.pushEncoder(new ParseMessageEncoder(statement));
  writer.pushData(FRAME.BIND_ANONYMOUS_PORTAL_NO_PARAMS);
  writer.pushData(FRAME.DESCRIBE_PORTAL_ANONYMOUS);
  writer.pushEncoder(new ExecuteMessageEncoder(0));
  writer.pushData(FRAME.SYNC);
}
