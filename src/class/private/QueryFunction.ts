import { QueryWriteQueue } from "@/protocol/MessageWriteQueue.ts";
import { QueryOptions, SqlStatement } from "@/interface/Query.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import type { QueryReader as IQueryReader } from "@/interface/Query.ts";
import QueryReader from "./QueryReader.ts";
import { createTypedSqlStatement } from "./sql_statement.ts";

export type QueryWriter = QueryWriteQueue | (() => Promise<QueryWriteQueue>);
export function isolationQuery<T>(
  writer: QueryWriter,
  queryable: SqlStatement,
  options?: QueryOptions & QueryOptionsWithDecoder,
): IQueryReader<T> {
  const encoder = createTypedSqlStatement(queryable, options);
  const query = (w: QueryWriteQueue) => {
    const p = w.extendedQuery<T>(encoder);
    w.sync();
    return p;
  };
  return new QueryReader(() => {
    if (typeof writer === "function") {
      return writer().then(query);
    } else {
      return query(writer);
    }
  });
}
export function relatedQuery<T>(
  writer: QueryWriter,
  queryable: SqlStatement,
  options?: QueryOptions & QueryOptionsWithDecoder,
): IQueryReader<T> {
  const encoder = createTypedSqlStatement(queryable, options);
  const query = (w: QueryWriteQueue) => {
    return w.extendedQuery<T>(encoder);
  };
  return new QueryReader(() => {
    if (typeof writer === "function") {
      return writer().then(query);
    } else {
      return query(writer);
    }
  });
}
