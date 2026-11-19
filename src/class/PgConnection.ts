import type { PgSession } from "@/protocol.ts";
import { ConnectionSource, PgConnectOptions } from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect_session.ts";
import { SingleQueryOperation } from "@/interface/Query.ts";
import { ConnQueryOperation } from "@/class/QueryOperation.ts";

export let createPgConnection: (session: PgSession) => PgConnection;

/**
 * @public
 */
export class PgConnection extends ConnQueryOperation implements AsyncDisposable, SingleQueryOperation {
  private constructor(session: PgSession) {
    const promise = Promise.withResolvers<void>();
    super(session, promise.resolve, promise.reject);
    this.finished = promise.promise;
  }
  #getSession() {
    return ConnQueryOperation.getSessionSafe(this);
  }
  get processId(): number | null {
    const session = this.#getSession();
    if (!session) return null;
    return session.processId;
  }
  get closed(): boolean {
    const session = this.#getSession();
    if (!session) return true;
    return session.closed;
  }
  readonly finished: Promise<void>;
  close(): Promise<void> {
    const session = this.#getSession();
    if (!session) return Promise.resolve();
    return session.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    return this.#getSession()?.destroy();
  }

  static async connect<T extends ConnectionSource>(source: T, options: PgConnectOptions<T>): Promise<PgConnection> {
    const session = await connectPgSession(source, options);
    return new PgConnection(session);
  }
  static {
    createPgConnection = (session) => {
      return new this(session);
    };
  }
}

export let createPgPoolConnection: (session: PgSession, onRelease: (session: PgSession) => void) => PgPoolConnection;
/**
 * @public
 */
export class PgPoolConnection extends ConnQueryOperation implements Disposable {
  private constructor(session: PgSession, onRelease: (session: PgSession) => void) {
    super(session);
    this.#onRelease = onRelease;
  }
  #onRelease: (session: PgSession) => void;
  #getSession() {
    return ConnQueryOperation.getSessionSafe(this);
  }

  get processId(): number | null {
    const session = this.#getSession();
    if (!session) return null;
    return session.processId;
  }
  release(): void {
    if (!this.#getSession()) return;
    this.#onRelease(ConnQueryOperation.transferSession(this));
  }
  get released(): boolean {
    return !this.#getSession();
  }

  [Symbol.dispose](): void {
    return this.release();
  }

  static {
    createPgPoolConnection = (session, onRelease) => {
      return new PgPoolConnection(session, onRelease);
    };
  }
}
