import { BackendMessageCode, FrontendMessageCode, PgTransactionStatus } from "@/protocol.ts";
import { QueryReadQueue } from "@/protocol/MessageReadQueue.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { QueryWriteQueue } from "@/protocol/MessageWriteQueue.ts";
import { EventEmitter } from "@/_utils/EventEmitter.ts";
import { BufferReader } from "@/_utils/StreamReader.ts";
import { MessageParsers } from "@/protocol/parsers/MessageParser.ts";
import { PgProtocolError } from "@/_utils/error.ts";

class MessageTypeParser {
  private readonly header = new Uint8Array(5);
  private readonly view = new DataView(this.header.buffer);
  private bodyLength?: number;
  private offset = 0;
  readonly types: number[] = [];

  get hasPending(): boolean {
    return this.offset > 0 || this.bodyLength !== undefined;
  }

  next(data: Uint8Array): void {
    let rest = data.byteLength;
    let offset = 0;

    while (rest > 0 || this.bodyLength === 0) {
      if (this.bodyLength !== undefined) {
        if (rest < this.bodyLength) {
          this.bodyLength -= rest;
          return;
        } else {
          rest -= this.bodyLength;
          offset += this.bodyLength;
          this.types.push(this.header[0]);
          this.bodyLength = undefined;
          if (rest === 0) return;
        }
      }

      const need = 5 - this.offset;
      if (rest < need) {
        this.header.set(data.subarray(offset, offset + rest), this.offset);
        this.offset += rest;
        return;
      } else {
        this.header.set(data.subarray(offset, offset + need), this.offset);
        this.offset = 0;
        offset += need;
        rest -= need;
        const messageLength = this.view.getUint32(1);
        if (messageLength < 4) throw new PgProtocolError(`Invalid PostgreSQL message length: ${messageLength}`);
        this.bodyLength = messageLength - 4;
      }
    }
  }
}
/**
 * 把 Parse、Bind、Describe、Execute， 压缩成 Execute
 */
function simplifyExtendQuery(code: number[]): number[] {
  const result: number[] = [];
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (
      c === FrontendMessageCode.Parse && code[i + 1] === FrontendMessageCode.Bind &&
      code[i + 2] === FrontendMessageCode.Describe && code[i + 3] === FrontendMessageCode.Execute
    ) {
      result.push(FrontendMessageCode.Execute);
      i += 3;
    } else {
      result.push(c);
    }
  }
  return result;
}

export class MessageTest extends EventEmitter {
  constructor({ maxWrite = Infinity }: { maxWrite?: number } = {}) {
    super();
    if (maxWrite !== Infinity && (!Number.isSafeInteger(maxWrite) || maxWrite <= 0)) {
      throw new RangeError("maxWrite must be a positive integer or Infinity");
    }
    this.readQueue.init(this.parsers);
    this.writeQueue = new QueryWriteQueue(
      new BufferShortWriter(async (data) => {
        if (this.writeError) throw this.writeError;
        const written = Math.min(data.byteLength, maxWrite);
        this.writtenMessages.next(data.subarray(0, written));
        return written;
      }, 8 * 1024),
      this.readQueue,
      () => this.emit("writeFree", this.messageTypes),
    );
  }
  private readonly parsers = new MessageParsers(1024);
  readonly readQueue = new QueryReadQueue();
  private readonly writtenMessages = new MessageTypeParser();
  readonly writeQueue: QueryWriteQueue;
  writeError?: Error;

  /** 累计发送的消息类型快照；完整的扩展查询消息组压缩为 Execute。 */
  get messageTypes(): number[] {
    return simplifyExtendQuery(this.writtenMessages.types);
  }
  get hasIncompleteFrame(): boolean {
    return this.writtenMessages.hasPending;
  }
  readyForQuery(status = PgTransactionStatus.Idle) {
    this.mockRead(BackendMessageCode.ReadyForQuery, Uint8Array.of(status));
  }
  commandComplete(rowCountOrTag: number | string = 1) {
    const tag = typeof rowCountOrTag === "number" ? `SELECT ${rowCountOrTag}` : rowCountOrTag;
    this.mockRead(BackendMessageCode.CommandComplete, `${tag}\0`);
  }
  errorResponse(message = "query failed") {
    this.mockRead(BackendMessageCode.ErrorResponse, `SERROR\0C22000\0M${message}\0\0`);
  }
  mockRead(code: BackendMessageCode, body?: Uint8Array | string) {
    if (typeof body === "string") {
      body = new TextEncoder().encode(body);
    }
    const frame = new Uint8Array(5 + (body?.byteLength ?? 0));
    frame[0] = code;
    new DataView(frame.buffer).setUint32(1, 4 + (body?.byteLength ?? 0));
    if (body) frame.set(body, 5);
    this.parsers.next(new BufferReader(frame, frame.byteLength));
  }
  /** 等待整个写队列排空并返回累计消息类型；简单查询等待 ReadyForQuery 时不会触发。 */
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
