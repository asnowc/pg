import { QueryReadQueue } from "./MessageReadQueue.ts";
import { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { AuthenticationResult } from "./auth.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import type { QueryResultParser } from "./parsers/QueryResultParser.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
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
    this.writer = new BufferWriter(this.stream.write.bind(this.stream), new Uint8Array(8 * 1024));
    this.writeQueue = new QueryWriteQueue(
      this.writer,
      this.readQueue,
      () => stream.closeWrite(),
      (cause: unknown) => {
        const error = cause instanceof Error ? cause : new Error("PostgreSQL query write failed", { cause });
        this.readQueue.fail(error);
        this.destroy(error);
      },
      () => {
        if (this.locked) return;
        this.emit("release");
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
        this.writeQueue.clear(err);
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
  private readonly writer: BufferWriter;

  get ttl(): number {
    return this.writeQueue.length + this.readQueue.length;
  }
  locked = false;
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
  #closedInfo?: Promise<void> | true;
  get closed(): boolean {
    return !!this.#closedInfo;
  }
  async close(): Promise<void> {
    if (!this.#closedInfo) {
      this.#closedInfo = this.writeQueue.close();
    }
    await this.#closedInfo;
  }

  destroy(error?: Error): void {
    this.#closedInfo = true;
    if (error) {
      this.emit("error", error);
    } else {
      error = new SessionDestroyedError();
    }
    this.readQueue.fail(error);
    this.stream.destroy();
  }
}

export interface PgSession {
  on(event: "error", callback: () => void): void;
  on(event: "close", callback: () => void): void;
  on(event: "release", callback: () => void): void;
  on(event: string, callback: Listener): void;

  off(event: "error", callback: Listener): void;
  off(event: "close", callback: Listener): void;
  off(event: "release", callback: Listener): void;
  off(event: string, callback: Listener): void;

  emit(event: "error", error: unknown): boolean;
  emit(event: "close"): boolean;
  emit(event: "release"): boolean;
  emit(event: string, ...args: unknown[]): boolean;
}
