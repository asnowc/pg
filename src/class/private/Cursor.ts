import { Cursor as ICursor, CursorOpenOptions, FieldInfo, QueryCompletion, SqlStatement } from "@/interface/Query.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { MaybePromise, processMaybePromise } from "@/internal/AsyncAble.ts";
import { HandleUnavailableError } from "@/internal/error.ts";
import { StatementPortal } from "@/protocol.ts";
import { QueryParserResult } from "@/protocol/QueryPortal.ts";

export default class Cursor<T> implements ICursor<T> {
  constructor(
    session: MaybePromise<PgSession>,
    private readonly onRelease: (writer: PgSession) => void,
    queryable: SqlStatement,
    options: CursorOpenOptions & QueryOptionsWithDecoder = {},
  ) {
    this.#portal = new StatementPortal(queryable, options);
    this.#completion = Promise.withResolvers<QueryCompletion>();
    const { promise, reject, resolve } = Promise.withResolvers<Readonly<FieldInfo>[]>();
    this.fields = promise;
    this.#session = processMaybePromise(session, (session) => {
      const { queryWriter } = session;
      queryWriter.prepare(this.#portal);
      queryWriter.describe(this.#portal, resolve, reject);
      return session;
    });
  }
  #session?: MaybePromise<PgSession>;
  #getSession() {
    if (!this.#session) throw new HandleUnavailableError("Cursor is closed");
    return this.#session;
  }
  #completion: PromiseWithResolvers<QueryCompletion>;
  get completion(): Promise<QueryCompletion> {
    return this.#completion.promise;
  }
  #portal: StatementPortal;
  fields: Promise<Readonly<FieldInfo>[]>;
  async read(maxRows: number): Promise<T[]> {
    const result = await processMaybePromise(this.#getSession(), ({ queryWriter }) => {
      return new Promise<QueryParserResult<any>>((resolve, reject) => {
        queryWriter.execute(this.#portal, maxRows);
        //TODO: 当前并发执行 read 会导致回调被覆盖，需要支持并发 execute
        this.#portal.resolve = resolve;
        this.#portal.reject = reject;
      });
    });
    this.rowsRead += result.rows.length;
    if (result.completed) {
      this.#completion.resolve({ notices: result.notices, rowCount: result.rowCount });
      const session = this.#session as PgSession;
      session.queryWriter.sync();
      this.#release(session);
    }
    return result.rows;
  }
  rowsRead = 0;
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    let rows: T[];
    do {
      rows = await this.read(1);
      yield* rows;
    } while (rows.length);
  }
  #release(session: PgSession) {
    this.#session = undefined;
    this.#closed = true;
    this.onRelease(session);
  }
  #closed?: Promise<void> | undefined | true;
  async close(): Promise<void> {
    if (this.#closed == undefined) {
      this.#closed = processMaybePromise(this.#getSession(), (session) => {
        const promise = session.queryWriter.closePortal(this.#portal).finally(() => {
          this.#completion.reject(new Error("Cursor has been closed"));
        });
        session.queryWriter.sync();
        this.#release(session);
        return promise;
      });
    }
    await this.#closed;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
