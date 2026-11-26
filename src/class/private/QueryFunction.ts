import { QueryOptions, SqlStatement } from "@/interface/Query.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";
import type { QueryReader as IQueryReader } from "@/interface/Query.ts";
import QueryReader from "./QueryReader.ts";
import { MaybePromise, processMaybePromise } from "@/_utils/AsyncAble.ts";
import { PgSession, StatementPortal } from "@/protocol.ts";
import { QueryParserResult } from "@/protocol/parsers/QueryTask.ts";

export type GetPgSession = () => MaybePromise<PgSession>;

export function isolationQuery<T>(
  getWriter: GetPgSession,
  queryable: SqlStatement,
  options?: QueryOptions & QueryOptionsWithDecoder,
): IQueryReader<T> {
  const portal = new StatementPortal(queryable, options);
  return new QueryReader(() => {
    return processMaybePromise(getWriter(), ({ queryWriter }) => {
      return new Promise<QueryParserResult<any>>((resolve, reject) => {
        queryWriter.prepare(portal);
        queryWriter.describe(portal);
        queryWriter.execute(portal);
        queryWriter.sync();
        queryWriter.flush();
        portal.resolve = resolve;
        portal.reject = reject;
      });
    });
  });
}
export function relatedQuery<T>(
  getWriter: GetPgSession,
  queryable: SqlStatement,
  options?: QueryOptions & QueryOptionsWithDecoder,
): IQueryReader<T> {
  const portal = new StatementPortal(queryable, options);
  return new QueryReader(() =>
    processMaybePromise(getWriter(), ({ queryWriter }) => {
      return new Promise<QueryParserResult<any>>((resolve, reject) => {
        queryWriter.prepare(portal);
        queryWriter.describe(portal);
        queryWriter.execute(portal);
        queryWriter.flush();
        portal.resolve = resolve;
        portal.reject = reject;
      });
    }),
  );
}
