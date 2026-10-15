import { QueryOperation } from "./private/QueryOperation.ts";
import type { PgSession } from "@/protocol.ts";
import { PgConnection as IPgConnection, PgPoolConnection as IPgPoolConnection } from "@/interface/Connection.ts";

export class PgConnection extends QueryOperation implements IPgConnection {
  constructor(session: PgSession) {
    super({
      get: () => this.#session,
      release: () => {},
    }, true);
    this.#session = session;
    this.finished = new Promise<void>((resolve, reject) => {
      this.#session.on("close", resolve);
      this.#session.on("error", reject);
    });
  }
  #session: PgSession;
  get processId(): number | null {
    return this.#session.processId;
  }
  get parameters(): Record<string, string> {
    return { ...this.#session.parameters };
  }
  get closed(): boolean {
    return this.#session.closed;
  }
  readonly finished: Promise<void>;
  close(): Promise<void> {
    return this.#session.close();
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    return this.#session.destroy();
  }
}

export class PgPoolConnection extends QueryOperation implements IPgPoolConnection {
  constructor(session: PgSession, onRelease: (session: PgSession) => void) {
    super({
      get: () => this.#getSession(),
      release: (session) => this.#session = session,
    }, true);
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
}
