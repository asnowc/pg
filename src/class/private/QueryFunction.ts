import { QueryOptions, SqlStatement } from "@/interface/Query.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import type { MultipleQueryReader, QueryReader as IQueryReader } from "@/interface/Query.ts";
import QueryReader from "./QueryReader.ts";
import { createTypedSqlStatement } from "./sql_statement.ts";
import { MaybePromise, processMaybePromise } from "@/_utils/AsyncAble.ts";
import { PgSession } from "@/protocol.ts";

export type GetPgSession = () => MaybePromise<PgSession>;

export function isolationQuery<T>(
  getWriter: GetPgSession,
  queryable: SqlStatement,
  options?: QueryOptions & QueryOptionsWithDecoder,
): IQueryReader<T> {
  const statement = createTypedSqlStatement(queryable, options);
  return new QueryReader(() => {
    return processMaybePromise(getWriter(), (session) => {
      const p = session.queryWriter.extendedQuery<T>(statement);
      session.queryWriter.sync();
      return p;
    });
  });
}
export function relatedQuery<T>(
  getWriter: GetPgSession,
  queryable: SqlStatement,
  options?: QueryOptions & QueryOptionsWithDecoder,
): IQueryReader<T> {
  const statement = createTypedSqlStatement(queryable, options);

  return new QueryReader(() =>
    processMaybePromise(getWriter(), (session: PgSession) => {
      return session.queryWriter.extendedQuery<T>(statement);
    })
  );
}
