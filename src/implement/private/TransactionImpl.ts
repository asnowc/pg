import type {
  Cursor,
  CursorOpenOptions,
  QueryOptions,
  QueryReader as IQueryReader,
  SqlStatement,
  Transaction,
  TransactionMode,
} from "@/interface/Query.ts";
import QueryReaderImpl from "./QueryReader.ts";
import { createTypedSqlStatement } from "./sql_statement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";

export class TransactionImpl implements Transaction {
  private ended = false;

  constructor(private readonly pool: unknown, readonly mode: TransactionMode = "READ COMMITTED") {
  }

  get released(): boolean {
    return this.ended;
  }

  query<T>(queryable: SqlStatement, options?: QueryOptions & QueryOptionsWithDecoder): IQueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReaderImpl<T>(async () => {
      throw new Error("Not implemented");
    });
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
  }

  async rollback(): Promise<void> {
    await this.query("ROLLBACK");
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.rollback();
  }
}
