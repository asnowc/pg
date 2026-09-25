import { QueryOperation } from "./private/QueryOperation.ts";
import type { PgSession } from "@/protocol.ts";
import type { ConnectionSource, PgConnectOptions } from "@/interface/Connection.ts";
import { connectPgSession } from "@/protocol/connect.ts";

/** @public */
export class PgConnection extends QueryOperation implements AsyncDisposable {
  static async connect<T extends ConnectionSource>(source: T, options: PgConnectOptions<T>): Promise<PgConnection> {
    const session = await connectPgSession(source, options);
    return new PgConnection(session);
  }
  private constructor(session: PgSession) {
    super(async () => session, () => {});
    this.#session = session;
  }
  #session: PgSession;
  get processId(): number | null {
    return this.#session.processId;
  }
  get parameters(): Record<string, string> {
    return { ...this.#session.parameters };
  }
  get closed(): boolean {
    return this.#session === undefined;
  }
  get finished(): Promise<void> {
    if (!this.#session) return Promise.resolve();
    return this.#session.finish;
  }
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
