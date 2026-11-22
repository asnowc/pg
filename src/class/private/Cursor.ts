import { Cursor as ICursor, CursorOpenOptions, FieldInfo, QueryCompletion, SqlStatement } from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./sql_statement.ts";
import { GetPgSession } from "./QueryFunction.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { MaybePromise, processMaybePromise } from "@/_utils/AsyncAble.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { HandleUnavailableError } from "@/_utils/error.ts";

export default class Cursor<T> implements ICursor<T> {
  constructor(
    getSession: GetPgSession,
    private readonly onRelease: (writer: PgSession) => void,
    queryable: SqlStatement,
    options: CursorOpenOptions & QueryOptionsWithDecoder = {},
  ) {
    let session = getSession();
    const statement = createTypedSqlStatement(queryable, options);
    if (session instanceof Promise) {
      const fields = Promise.withResolvers<Readonly<FieldInfo>[]>();
      this.fields = fields.promise;
      this.fields.catch(() => {});
      session = session.then((session) => {
        this.#session = session;
        session.queryWriter.openCursor(statement).then(fields.resolve, fields.reject);
        return session;
      });
      session.catch(() => {});
    } else {
      this.fields = session.queryWriter.openCursor(statement);
    }
    this.#session = session;
    this.#statement = statement;
    this.#completion = Promise.withResolvers<QueryCompletion>();
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
  #statement: TypedSqlStatement;
  fields: Promise<Readonly<FieldInfo>[]>;
  async read(maxRows: number): Promise<T[]> {
    const result = await processMaybePromise(this.#getSession(), (session) => {
      return session.queryWriter.executePortal<T>(this.#statement, maxRows);
    });
    this.rowsRead += result.rows.length;
    if (result.completed) {
      this.#completion.resolve({ notices: result.notices, rowCount: result.rowCount });
      this.#release();
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
  #release() {
    this.onRelease(this.#session as PgSession);
    this.#closed = true;
  }
  #closed?: Promise<void> | undefined | true;
  async close(): Promise<void> {
    if (this.#closed == undefined) {
      this.#closed = processMaybePromise(this.#getSession(), (session) => {
        return session.queryWriter.closePortal(this.#statement).then(() => {
          this.#completion.reject(new Error("Cursor has been closed"));
        });
      });
    }
    await this.#closed;
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
