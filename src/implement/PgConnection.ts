import { QueryOperation } from "./QueryOperation.ts";
import type { ByteStream } from "@/interface/ByteStream.ts";
import type { PgSession } from "@/protocol.ts";
import type { PgConnectOptions } from "@/interface/Connection.ts";
import { connectFromByteStream } from "@/protocol/connect.ts";

/** @public */
export class PgConnection extends QueryOperation implements AsyncDisposable {
  static async connect(conn: ByteStream, options: PgConnectOptions): Promise<PgConnection> {
    const session = await connectFromByteStream(conn, options);
    return new PgConnection(session);
  }
  private constructor(session: PgSession) {
    super(async () => session, () => {});
    this.#session = session;
  }
  #session?: PgSession;
  get closed(): boolean {
    return this.#session === undefined;
  }
  get finished(): Promise<void> {
    if (!this.#session) return Promise.resolve();
    return this.#session.finish;
  }
  async close(): Promise<void> {
    if (!this.#session) return;
    const session = await this.#session;
    await session.close();
    this.#session = undefined;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
  destroy(): void {
    const session = this.#session;
    if (!session) return;
    this.#session = undefined;
    return session.destroy();
  }
}
