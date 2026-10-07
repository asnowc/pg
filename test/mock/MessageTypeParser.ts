import { BackendMessageCode, FrontendMessageCode, PgTransactionStatus } from "@/protocol.ts";
import { QueryReadQueue } from "@/protocol/MessageReadQueue.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { QueryWriteQueue } from "@/protocol/MessageWriteQueue.ts";
import { EventEmitter } from "@/_utils/EventEmitter.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { MessageParsers } from "@/protocol/parsers/MessageParser.ts";

class MessageTypeParser {
  constructor() {
    const buffer = new Uint8Array(5);
    this.buffer = buffer;
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  readonly types: number[] = [];
  next(data: Uint8Array): void {
    const byteLength = data.byteLength;
    let rest = byteLength;
    let offset = 0;

    while (rest > 0) {
      if (this.bodyLength !== undefined) {
        if (rest < this.bodyLength) {
          this.bodyLength -= rest;
          return;
        } else {
          rest -= this.bodyLength;
          this.bodyLength = undefined;
        }
      }

      const need = 5 - this.offset;
      if (rest < need) {
        this.buffer.set(data.subarray(offset, offset + rest), this.offset);
        this.offset += rest;
        return;
      } else {
        this.buffer.set(data.subarray(offset, offset + need), this.offset);
        this.offset = 0;
        offset += need;
        rest -= need;
        this.types.push(this.buffer[0]);
        this.bodyLength = this.view.getUint32(1);
      }
    }
  }
  private bodyLength?: number;
  private offset = 0;
  private readonly buffer = new Uint8Array(5);
  private readonly view: DataView;
}
/**
 * 把 Parse、Bind、Describe、Execute， 压缩成 Execute
 */
function simplifyExtendQuery(code: number[]): number[] {
  const result: number[] = [];
  let isInParse = false;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (isInParse) {
      if (c !== FrontendMessageCode.Execute) {
        continue;
      }
      isInParse = false;
    } else if (c === FrontendMessageCode.Parse) {
      isInParse = true;
    }
    result.push(c);
  }
  return result;
}

export class MessageTest extends EventEmitter {
  constructor() {
    super();
    this.readQueue.init(this.parsers);
  }
  private readonly parsers = new MessageParsers(1024);
  private readonly readQueue = new QueryReadQueue();
  private readonly whitenTypes = new MessageTypeParser();
  readonly writeQueue = new QueryWriteQueue(
    new BufferShortWriter(async (data) => {
      this.whitenTypes.next(data);
      return data.byteLength;
    }, 8 * 1024),
    this.readQueue,
    () => this.emit("writeFree", simplifyExtendQuery(this.whitenTypes.types)),
  );

  readyForQuery(status: PgTransactionStatus) {
    this.mockRead(BackendMessageCode.ReadyForQuery, Uint8Array.of(status));
  }
  commandComplete(rowCount: number) {
    this.mockRead(BackendMessageCode.CommandComplete, `SELECT ${rowCount}\0`);
  }
  mockRead(code: BackendMessageCode, body?: Uint8Array | string) {
    if (typeof body === "string") {
      body = new TextEncoder().encode(body);
    }
    const frame = new Uint8Array(5);
    frame[0] = code;
    new DataView(frame.buffer).setUint32(1, 4 + (body?.byteLength ?? 0));

    this.parsers.next(new BufferReader(frame, frame.byteLength));
    if (body) this.parsers.next(new BufferReader(body, body.byteLength));
  }
  onWriteFree(): Promise<number[]> {
    return new Promise<number[]>((resolve) => {
      const onWriteFree = (data: number[]) => {
        resolve(data);
        this.off("writeFree", onWriteFree);
      };
      this.on("writeFree", onWriteFree);
    });
  }
}
