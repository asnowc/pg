import { QueryReadQueue } from "./MessageReadQueue.ts";
import { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { AuthenticationResult } from "./auth.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { BufferWriter } from "@/_utils/BufferWriter.ts";
import { EventEmitter, Listener } from "@/_utils/EventEmitter.ts";
import { SessionDestroyedError, UnexpectedEOFError } from "@/_utils/error.ts";
import { BufferWriterQueue } from "@/_utils/BufferWriterQueue.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

function createBufferWriter(stream: ConnectionStream) {
  const flushThreshold = 8 * 1024;
  return new BufferWriter(
    stream.write.bind(stream),
    new Uint8Array(flushThreshold * 2),
    flushThreshold,
  );
}
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

    const writer = createBufferWriter(stream);
    const bufferWriterQueue = new BufferWriterQueue(writer, () => stream.closeWrite(), (cause: unknown) => {
      const error = cause instanceof Error ? cause : new Error("PostgreSQL query write failed", { cause });
      this.readQueue.fail(error);
      this.destroy(error);
    });
    this.queryWriter = new QueryWriteQueue(bufferWriterQueue, this.readQueue);
    const parser = new MessageParsers(maxMessageSize);
    this.readQueue.init(parser, this.queryWriter);

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
  get pendingQueyNumber() {
    return this.readQueue.pendingQueyNumber;
  }
  get idle(): boolean {
    return !this.readQueue.head;
  }
  readonly queryWriter: QueryWriteQueue;
  private readonly readQueue = new QueryReadQueue(() => this.emit("idle"));

  #closedInfo?: Promise<void> | true;
  get closed(): boolean {
    return !!this.#closedInfo;
  }
  async close(): Promise<void> {
    if (!this.#closedInfo) {
      this.#closedInfo = this.queryWriter.close();
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
