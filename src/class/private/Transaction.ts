import type {
  Cursor,
  CursorOpenOptions,
  QueryOptions,
  QueryReader as IQueryReader,
  SqlStatement,
  Transaction as ITransaction,
  TransactionMode,
} from "@/interface/Query.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { QueryWriter, relatedQuery } from "./QueryFunction.ts";

export default class Transaction implements ITransaction {
  constructor(
    private getWriter: QueryWriter | undefined,
    private readonly onRelease: () => void,
    readonly mode: TransactionMode = "READ COMMITTED",
  ) {
  }
  private getWriterStrict(): QueryWriter {
    if (!this.getWriter) throw new Error("Transaction writer is not available");
    return this.getWriter;
  }
  get released(): boolean {
    return !this.getWriter;
  }

  query<T>(queryable: SqlStatement, options?: QueryOptions & QueryOptionsWithDecoder): IQueryReader<T> {
    return relatedQuery(this.getWriterStrict(), queryable, options);
  }

  open<T>(_queryable: SqlStatement, _options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }

  async savePoint(name: string): Promise<void> {
    await this.query(`SAVEPOINT ${name}`);
  }

  async rollbackTo(name: string): Promise<void> {
    await this.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }

  async commit(): Promise<void> {
    await this.query("COMMIT");
    this.release();
  }

  async rollback(): Promise<void> {
    await this.query("ROLLBACK");
    this.release();
  }
  private release(): void {
    if (!this.getWriter) return;
    this.getWriter = undefined;
    this.onRelease();
  }

  [Symbol.asyncDispose](): Promise<void> {
    if (!this.getWriter) return Promise.resolve();
    return this.rollback();
  }
}
