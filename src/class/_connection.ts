import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyQueryOperation,
  CopyToOptions,
  Cursor,
  CursorOpenOptions,
  CursorQueryOperation,
  MultipleQueryOperation,
  QueryOptions,
  QueryReader as IQueryReader,
  SampleQueryReader,
  SingleQueryOperation,
  SqlStatement,
  SqlStatements,
  Transaction,
  TransactionMode,
  TransactionQueryOperation,
} from "@/interface/Query.ts";
import { createTypedSqlStatement } from "./private/sql_statement.ts";
import QueryReader from "./private/QueryReader.ts";
import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import { PgSession } from "@/protocol/PgSession.ts";
import { QueryWriteQueue } from "@/protocol/MessageWriteQueue.ts";

export type GetSession = (resolve: (session: PgSession) => void, reject: (error: unknown) => void) => void;

export interface SessionRef {
  getWriter(): QueryWriteQueue;
  transferWriter(): QueryWriteQueue;
}

export class QueryOperation
  implements MultipleQueryOperation, SingleQueryOperation, CursorQueryOperation, TransactionQueryOperation {
  constructor(private core: SessionRef) {
  }

  query<T>(
    queryable: SqlStatement | TypedSqlStatement<T>,
    options?: QueryOptions & QueryOptionsWithDecoder,
  ): IQueryReader<T> {
    const encoder = createTypedSqlStatement(queryable, options);
    return new QueryReader(() => {
      return new Promise((resolve) => {
        const writer = this.core.getWriter();
        const promise = writer.extendedQuery<T>(encoder);
        writer.sync();
        resolve(promise);
      });
    });
  }

  begin(mode?: TransactionMode): Transaction {
    throw new Error("Not implemented");
  }
  open<T>(queryable: SqlStatement | TypedSqlStatement<T>, options?: CursorOpenOptions): Promise<Cursor<T>> {
    throw new Error("Not implemented");
  }

  queryMultiple(queryable: SqlStatements, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: ReadableStream<Uint8Array>, options?: QueryOptions): SampleQueryReader<unknown[]>;
  queryMultiple(queryable: unknown, _options?: unknown): SampleQueryReader {
    if (typeof queryable !== "string") throw new TypeError("Only string simple queries are supported");
    throw new Error("Not implemented");
  }
}
