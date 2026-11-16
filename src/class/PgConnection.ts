import type { PgSession } from "@/protocol.ts";
import { ConnectionSource, PgConnectOptions } from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect_session.ts";
import { SingleQueryOperation } from "@/interface/Query.ts";
import { QueryOperation, SessionRef } from "@/class/_connection.ts";
import { QueryWriteQueue } from "@/protocol/MessageWriteQueue.ts";

export let getSessionFromPgConnection: (operation: PgConnection) => PgSession;
export let createPgConnection: (session: PgSession) => PgConnection;

class SessionRefImpl implements SessionRef {
  constructor(private session?: PgSession) {
    session?.on("release", this.onRelease);
  }
  private onRelease = () => {
    this.stack.pop();
  };
  private get currentLock() {
    return this.stack[this.stack.length - 1];
  }
  private readonly stack: (object | undefined)[] = [];
  get released(): boolean {
    return !this.session;
  }
  get processId(): number | null {
    if (!this.session) return null;
    return this.session.processId;
  }
  get closed(): boolean {
    if (!this.session) return true;
    return this.session.closed;
  }
  close(): Promise<void> {
    if (!this.session) return Promise.resolve();
    return this.getWriter().close();
  }
  destroy(): void {
    if (!this.session) return;
    return this.session.destroy();
  }
  release(): void {
    const session = this.session;
    if (!session) return;
    this.session = undefined;
    session.emit("release");
  }
  getSession() {
    if (!this.session) throw new Error("Session is not available");
    return this.session;
  }
  getWriter(key?: object): QueryWriteQueue {
    const session = this.getSession();
    if (key !== this.currentLock) throw new Error("Session is locked by another handle");
    return session.queryWriter;
  }
  lock(lock: object) {
    this.stack.push(lock);
  }
  transferSession(): PgSession {
    const session = this.getSession();
    const writer = this.getWriter();
    this.stack.length = 0;
    return session;
  }
  transferWriter(): QueryWriteQueue {
    const writer = this.getWriter();
    return writer;
  }
}
/**
 * @public
 */
export class PgConnection extends QueryOperation implements AsyncDisposable, SingleQueryOperation {
  private constructor(session: PgSession) {
    const ref = new SessionRefImpl(session);
    super(ref);
    this.#ref = ref;
    this.finished = new Promise<void>((resolve, reject) => {
      session.on("close", resolve);
      session.on("error", reject);
      this.#clearListener = () => {
        session.off("close", resolve);
        session.off("error", reject);
      };
    });
  }
  #ref: SessionRefImpl;
  #clearListener!: () => void;
  get processId(): number | null {
    return this.#ref.processId;
  }
  get closed(): boolean {
    return this.#ref.closed;
  }
  readonly finished: Promise<void>;
  close(): Promise<void> {
    return this.#ref.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    return this.#ref.destroy();
  }

  static async connect<T extends ConnectionSource>(source: T, options: PgConnectOptions<T>) {
    const session = await connectPgSession(source, options);
    return new PgConnection(session);
  }
  static {
    getSessionFromPgConnection = (operation: PgConnection) => {
      operation.#clearListener();
      return operation.#ref.transferSession();
    };
    createPgConnection = (session) => {
      return new this(session);
    };
  }
}

export let createPgPoolConnection: (session: PgSession) => PgPoolConnection;
/**
 * @public
 */
export class PgPoolConnection extends QueryOperation implements Disposable {
  private constructor(session: PgSession) {
    const ref = new SessionRefImpl(session);
    super(ref);
    this.#ref = ref;
    this.#session = session;
  }
  #session: PgSession;
  #ref: SessionRefImpl;

  get processId(): number | null {
    return this.#session.processId;
  }
  release(): void {
    return this.#ref.release();
  }
  get released(): boolean {
    return this.#ref.released;
  }

  [Symbol.dispose](): void {
    return this.release();
  }

  static {
    createPgPoolConnection = (session) => {
      return new PgPoolConnection(session);
    };
  }
}
