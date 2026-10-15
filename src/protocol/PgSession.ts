import { QueryReadQueue } from "./MessageReadQueue.ts";
import { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { AuthenticationResult } from "./auth.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import type { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { EventEmitter, Listener } from "@/_utils/EventEmitter.ts";
import { SessionDestroyedError, UnexpectedEOFError } from "@/_utils/error.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

export class PgSession<T = unknown> extends EventEmitter {
  constructor(
    private readonly stream: ConnectionStream,
    config: {
      maxMessageSize?: number;
      authResult: AuthenticationResult;
      meta: T;
    },
  ) {
    super();
    const { authResult, maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE, meta } = config;
    this.stream = stream;
    this.meta = meta;
    const backendKey = authResult.backendKey;
    this.processId = backendKey?.processId ?? null;
    this.secretKey = backendKey?.secretKey ?? null;

    const parser = new MessageParsers(maxMessageSize);
    this.writer = new BufferShortWriter(this.stream.write.bind(this.stream), new Uint8Array(8 * 1024));
    this.writeQueue = new QueryWriteQueue(
      this.writer,
      this.readQueue,
      () => {
        this.emit("writeFree");
        if (this.closed) {
          this.stream.closeWrite().then(
            () => void this.writeQueue.setClosed(),
            (e) => void this.destroy(e),
          );
        }
      },
    );
    this.readQueue.init(parser, this.writeQueue);

    stream.startReadLoop(() => parser.next(this.stream), () => {
      if (this.readQueue.head) {
        this.readQueue.fail(new UnexpectedEOFError());
      }
      if (!this.closed) {
        this.destroy(new UnexpectedEOFError());
      }
      this.emit("close");
    });
    stream.listenOnError((err) => {
      if (this.closed) {
        //这里可能是 this.destroy() 被调用导致 write error
        this.readQueue.fail(err);
        this.writeQueue.rejectQueue(err);
      } else {
        this.destroy(err);
      }
      this.emit("close");
    });
  }
  readonly processId: number | null;
  readonly secretKey: number | null;

  meta: T;

  get parameters(): Record<string, string> {
    return this.readQueue.parameters;
  }
  private readonly writeQueue: QueryWriteQueue;
  private readonly readQueue = new QueryReadQueue();
  private readonly writer: BufferShortWriter;

  get hasPending(): boolean {
    return this.writeQueue.hasPending;
  }

  checkWriteQueue(): void {
    this.writeQueue.checkWriteQueue();
  }
  beginTransaction(mode?: TransactionMode): void {
    return this.writeQueue.beginTransaction(mode);
  }
  commitTransaction(): void {
    return this.writeQueue.commitTransaction();
  }
  rollbackTransaction(): void {
    return this.writeQueue.rollbackTransaction();
  }
  extendedQuery<T>(statement: TypedSqlStatementEncoder): Promise<QueryResultParser<T>> {
    return this.writeQueue.extendedQuery<T>(statement);
  }
  sync(): void {
    this.writeQueue.sync();
  }

  close(): Promise<void> {
    return this.writeQueue.close();
  }
  /** 释放已调用 close() */
  get closed(): boolean {
    return this.writeQueue.closed;
  }
  destroy(error?: Error): void {
    this.writeQueue.setClosed();
    if (error) {
      this.emit("error", error);
    } else {
      error = new SessionDestroyedError();
    }
    this.readQueue.fail(error);
    this.writeQueue.rejectQueue(error);
    this.stream.destroy();
  }
}

export interface PgSession {
  on(event: "writeFree", callback: () => void): void;
  on(event: "error", callback: () => void): void;
  on(event: "close", callback: () => void): void;
  on(event: "release", callback: () => void): void;
  on(event: string, callback: Listener): void;

  off(event: "error", callback: Listener): void;
  off(event: "writeFree", callback: Listener): void;
  off(event: "close", callback: Listener): void;
  off(event: "release", callback: Listener): void;
  off(event: string, callback: Listener): void;

  emit(event: "error", error: unknown): boolean;
  emit(event: "writeFree"): boolean;
  emit(event: "close"): boolean;
  emit(event: "release"): boolean;
  emit(event: string, ...args: unknown[]): boolean;
}
