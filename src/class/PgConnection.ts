import type { PgSession } from "@/protocol.ts";
import { QueryOperation } from "./_connection.ts";
import { ConnectionSource, PgConnectOptions } from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect.ts";

export let getSessionFromPgConnection: (operation: PgConnection) => PgSession;
export let createPgConnection: (session: PgSession) => PgConnection;

/**
 * @public
 */
export class PgConnection extends QueryOperation implements AsyncDisposable {
  private constructor(session: PgSession) {
    super(() => this.#getSession());
    this.#session = session;
    this.finished = new Promise<void>((resolve, reject) => {
      session.on("close", resolve);
      session.on("error", reject);
    });
  }
  #getSession() {
    if (!this.#session) throw new Error("PoolConnection is already released");
    return this.#session;
  }
  #session?: PgSession;
  get processId(): number | null {
    return this.#getSession().processId;
  }
  get parameters(): Record<string, string> {
    return { ...this.#getSession().parameters };
  }
  get closed(): boolean {
    return this.#getSession().closed;
  }
  readonly finished: Promise<void>;
  close(): Promise<void> {
    return this.#getSession().close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    return this.#getSession().destroy();
  }

  static async connect<T extends ConnectionSource>(source: T, options: PgConnectOptions<T>) {
    const session = await connectPgSession(source, options);
    return new PgConnection(session);
  }
  static {
    getSessionFromPgConnection = (operation: PgConnection) => {
      const session = operation.#getSession();
      operation.#session = undefined;
      return session;
    };
    createPgConnection = (session) => {
      return new this(session);
    };
  }
}
export let createPgPoolConnection: (session: PgSession, onRelease: (session: PgSession) => void) => PgPoolConnection;
/**
 * @public
 */
export class PgPoolConnection extends QueryOperation implements Disposable {
  private constructor(session: PgSession, onRelease: (session: PgSession) => void) {
    super(() => {
      if (!this.#session) throw new Error("PoolConnection is already released");
      return this.#session;
    });
    this.#release = onRelease;
    this.#session = session;

    this.processId = session.processId;
  }
  #getSession() {
    if (!this.#session) throw new Error("PoolConnection is already released");
    const session = this.#session;
    this.#session = undefined;
    return session;
  }
  #session?: PgSession;
  #release?: (session: PgSession) => void;

  readonly processId: number | null;

  release(): void {
    if (!this.#release) return;
    const session = this.#getSession();
    const release = this.#release;
    this.#release = undefined;
    release(session);
  }
  get released(): boolean {
    return !this.#release;
  }
  get closed(): boolean {
    return !this.#session || this.#session.closed;
  }

  close(): Promise<void> {
    return this.#getSession().close();
  }
  destroy(): void {
    return this.#getSession().destroy();
  }

  [Symbol.dispose]() {
    return this.release();
  }
  static {
    createPgPoolConnection = (session, onRelease) => {
      return new PgPoolConnection(session, onRelease);
    };
  }
}
