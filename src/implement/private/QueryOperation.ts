import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyQueryOperation,
  CopyToOptions,
  Cursor,
  CursorOpenOptions,
  CursorQueryOperation,
  MultipleQueryOperation,
  PipelineQueryOperation,
  QueryOptions,
  QueryReader,
  SampleQueryReader,
  SingleQueryOperation,
  SqlStatement,
  SqlStatements,
  Transaction,
  TransactionMode,
  TransactionQueryOperation,
  TypedSqlStatement,
  TypedSqlStatementEncoder,
} from "@/interface/Query.ts";
import { sqlStatementToSqlEncoder } from "./sql_statement.ts";
import QueryReaderImpl, { SessionHandle } from "./QueryReader.ts";
import { TransactionImpl } from "./TransactionImpl.ts";

export class QueryOperation
  implements
    PipelineQueryOperation,
    MultipleQueryOperation,
    SingleQueryOperation,
    CopyQueryOperation,
    CursorQueryOperation,
    TransactionQueryOperation {
  constructor(private pool: SessionHandle, private canPipeline: boolean) {}
  query<T>(
    queryable: SqlStatement<T> | TypedSqlStatementEncoder<T>,
    options?: QueryOptions & Pick<TypedSqlStatement, "typeDecoders" | "columnDecoders">,
  ): QueryReader<T> {
    const encoder = sqlStatementToSqlEncoder(queryable, options);
    return new QueryReaderImpl<T>({ isolated: !this.canPipeline, pool: this.pool, statement: encoder });
  }

  begin(mode?: TransactionMode): Transaction {
    return new TransactionImpl(this.pool, mode);
  }
  open<T>(queryable: SqlStatement<T>, options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }
  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle {
    throw new Error("Not implemented");
  }
  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array> {
    throw new Error("Not implemented");
  }

  pipeline(queryable: unknown, options?: unknown): QueryReader<unknown> {
    throw new Error("Not implemented");
  }

  queryMultiple(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: unknown, _options?: unknown): SampleQueryReader {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    throw new Error("Not implemented");
  }
}
