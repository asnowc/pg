import { QueryReadQueue } from "./MessageReadQueue.ts";
import { QueryWriteQueue } from "./MessageWriteQueue.ts";
import { AuthenticationResult } from "./auth.ts";
import { encodeTerminateMessage } from "./encode.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import type { QueryResultParser, SampleQueryResultParser } from "./parsers/QueryResultParser.ts";
import { BufferShortWriter } from "@/_utils/StreamWriter.ts";
import { EventEmitter, Listener } from "@/_utils/EventEmitter.ts";

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
    this.writeQueue = new QueryWriteQueue(this.writer, this.readQueue, () => this.emit("writeFree"));
    this.readQueue.init(parser);

    stream.startReadLoop(() => parser.next(this.stream), () => {
      this.readQueue.fail(new Error("PostgreSQL connection closed"));
      if (!this.isCloseCalled) this.destroy();
      this.emit("close");
    });
    stream.listenOnError((err) => {
      this.readQueue.fail(err);
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

  simpleQuery(statement: TypedSqlStatementEncoder): Promise<SampleQueryResultParser> {
    return this.writeQueue.simpleQuery(statement);
  }
  extendedQuery<T>(statement: TypedSqlStatementEncoder): Promise<QueryResultParser<T>> {
    return this.writeQueue.extendedQuery<T>(statement);
  }
  beginTransaction(mode?: TransactionMode): void {
    return this.writeQueue.beginTransaction(mode);
  }
  endTransaction(rollback?: boolean): void {
    return this.writeQueue.endTransaction(rollback);
  }

  private closePromise?: Promise<void> | boolean;
  /** 如果为 true , 则不可再进行写入操作 */
  private get isCloseCalled() {
    return !!this.closePromise;
  }
  async close(): Promise<void> {
    if (this.isCloseCalled) {
      await this.closePromise;
      return;
    }
    return this.closePromise = this.#close().then(
      () => void (this.closePromise = true),
      () => void (this.closePromise = true),
    );
  }
  async #close() {
    if (this.hasPending) await new Promise((resolve) => this.on("close", resolve));
    await this.writer.writeData(encodeTerminateMessage());
    return this.stream.closeWrite();
  }
  destroy(): void {
    this.readQueue.fail(new Error("PostgreSQL connection destroyed"));
    this.stream.destroy();
    this.closePromise = true;
  }
}

export interface PgSession {
  on(event: "writeFree", callback: () => void): void;
  on(event: "close", callback: () => void): void;
  on(event: "release", callback: () => void): void;
  on(event: string, callback: Listener): void;

  off(event: "writeFree", callback: Listener): void;
  off(event: "close", callback: Listener): void;
  off(event: "release", callback: Listener): void;
  off(event: string, callback: Listener): void;

  emit(event: "writeFree"): boolean;
  emit(event: "close"): boolean;
  emit(event: "release"): boolean;
  emit(event: string, ...args: unknown[]): boolean;
}
