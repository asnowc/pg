import type {
  Cursor,
  CursorOpenOptions,
  QueryOptions,
  QueryReader as IQueryReader,
  SqlStatement,
  Transaction,
  TransactionMode,
  TypedSqlStatement,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { SessionHandle } from "./QueryReader.ts";

export class TransactionImpl implements Transaction {
  private ended = false;

  constructor(private readonly pool: SessionHandle, readonly mode: TransactionMode = "READ COMMITTED") {
  }

  get released(): boolean {
    return this.ended;
  }

  query<T>(
    queryable: SqlStatement<T> | TypedSqlStatementEncoder<T>,
    options?: QueryOptions & Pick<TypedSqlStatement, "typeDecoders" | "columnDecoders">,
  ): IQueryReader<T> {
    throw new Error("Not implemented");
  }

  open<T>(_queryable: SqlStatement<T>, _options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }

  async savePoint(name: string): Promise<void> {
    throw new Error("Not implemented");
  }

  async rollbackTo(name: string): Promise<void> {
    throw new Error("Not implemented");
  }

  commit(): Promise<void> {
    throw new Error("Not implemented");
  }

  rollback(): Promise<void> {
    throw new Error("Not implemented");
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.rollback();
  }
}
