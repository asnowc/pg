import { QueryOperation } from "./private/QueryOperation.ts";
import type { ByteStream } from "@/interface/ByteStream.ts";
import type { PgSessionInfo } from "@/interface/protocol.ts";
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
  #session: PgSession;

  get session(): Readonly<PgSessionInfo> {
    return this.#session.sessionInfo;
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
