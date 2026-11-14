import type { PgSession } from "@/protocol.ts";
import { ConnectionSource, PgConnectOptions } from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect_session.ts";
import { SingleQueryOperation } from "@/interface/Query.ts";
import { QueryOperation, SessionRef } from "@/class/_connection.ts";

export let getSessionFromPgConnection: (operation: PgConnection) => PgSession;
export let createPgConnection: (session: PgSession) => PgConnection;

/**
 * @public
 */
export class PgConnection extends QueryOperation implements AsyncDisposable, SingleQueryOperation {
  private constructor(session: PgSession) {
    const ref = new SessionRef(session);
    super(ref);
    this.#ref = ref;
    this.finished = new Promise<void>((resolve, reject) => {
      session.on("close", resolve);
      session.on("error", reject);
    });
  }
  #ref: SessionRef;

  get processId(): number | null {
    if (!this.#ref.session) return null;
    return this.#ref.session.processId;
  }
  get parameters(): Record<string, string> {
    if (!this.#ref.session) return {};
    return { ...this.#ref.session.parameters };
  }
  get closed(): boolean {
    if (!this.#ref.session) return true;
    return this.#ref.session.closed;
  }
  readonly finished: Promise<void>;
  close(): Promise<void> {
    if (!this.#ref.session) return Promise.resolve();
    return this.#ref.session.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    if (!this.#ref.session) return;
    return this.#ref.session.destroy();
  }

  static async connect<T extends ConnectionSource>(source: T, options: PgConnectOptions<T>) {
    const session = await connectPgSession(source, options);
    return new PgConnection(session);
  }
  static {
    getSessionFromPgConnection = (operation: PgConnection) => {
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
    const ref = new SessionRef(session);
    super(ref);
    this.#ref = ref;
  }
  #ref: SessionRef;

  get processId(): number | null {
    if (!this.#ref.session) return null;
    return this.#ref.session.processId;
  }
  release(): void {
    const session = this.#ref.session;
    if (!session) return;
    this.#ref.session = undefined;
    session.emit("release");
  }
  get released(): boolean {
    return !this.#ref.session;
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
