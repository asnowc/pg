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
import { sqlStatementToSqlEncoder } from "./sql_statement.ts";

export class TransactionImpl implements Transaction {
  private ended = false;

  constructor(private readonly pool: unknown, readonly mode: TransactionMode = "READ COMMITTED") {
  }

  get released(): boolean {
    return this.ended;
  }

  query<T>(queryable: SqlStatement, options?: QueryOptions): IQueryReader<T> {
    const encoder = sqlStatementToSqlEncoder(queryable, options);
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
