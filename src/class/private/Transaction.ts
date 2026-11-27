import type {
  Cursor as ICursor,
  CursorOpenOptions,
  QueryOptions,
  QueryReader as IQueryReader,
  SqlStatement,
  Transaction as ITransaction,
  TransactionMode,
} from "@/interface/Query.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { GetPgSession, relatedQuery } from "./QueryFunction.ts";
import { MaybePromise, processMaybePromise } from "@/internal/AsyncAble.ts";
import { HandleUnavailableError } from "@/internal/error.ts";
import { PgSession } from "@/protocol.ts";
import Cursor from "./Cursor.ts";

function checkName(name: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid savepoint name: ${name}`);
  }
}

export default class Transaction implements ITransaction {
  constructor(
    getSession: GetPgSession,
    private readonly onRelease: (writer: PgSession) => void,
    readonly mode: TransactionMode = "READ COMMITTED",
  ) {
    let session = getSession();
    if (session instanceof Promise) {
      session = session.then((session) => {
        this.session = session;
        session.queryWriter.beginTransaction(this.mode);
        return session;
      });
      session.catch(() => {});
    } else {
      session.queryWriter.beginTransaction(this.mode);
    }
    this.session = session;
  }
  private session?: MaybePromise<PgSession>;
  private getWriterStrict = () => {
    if (!this.session) throw new HandleUnavailableError("Transaction session is not available");
    return this.session;
  };
  private transferGetWriter = () => {
    const writer = this.getWriterStrict();
    this.session = undefined;
    return writer;
  };

  get released(): boolean {
    return !this.session;
  }

  query<T>(queryable: SqlStatement, options?: QueryOptions & QueryOptionsWithDecoder): IQueryReader<T> {
    return relatedQuery(this.getWriterStrict, queryable, options);
  }

  open<T>(queryable: SqlStatement, options?: CursorOpenOptions & QueryOptionsWithDecoder): ICursor<T> {
    return new Cursor<T>(this.transferGetWriter(), (session) => (this.session = session), queryable, options);
  }

  async savePoint(name: string): Promise<void> {
    checkName(name);
    await relatedQuery(this.getWriterStrict, `SAVEPOINT ${name}`);
  }

  async rollbackTo(name: string): Promise<void> {
    checkName(name);
    await relatedQuery(this.getWriterStrict, `ROLLBACK TO SAVEPOINT ${name}`);
  }

  async commit(): Promise<void> {
    await processMaybePromise(this.transferGetWriter(), (writer) => {
      const result = writer.queryWriter.commitTransaction();
      this.onRelease(writer);
      return result;
    });
  }

  async rollback(): Promise<void> {
    await processMaybePromise(this.transferGetWriter(), (writer) => {
      const result = writer.queryWriter.rollbackTransaction();
      this.onRelease(writer);
      return result;
    });
  }

  [Symbol.asyncDispose](): Promise<void> {
    if (!this.session) return Promise.resolve();
    return this.rollback();
  }
}
