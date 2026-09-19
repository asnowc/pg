import type { QueryDecoder, SqlStatement, StatementEncoder } from "@/interface/Query.ts";
import { TextSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";

export function sqlStatementToSqlEncoder(
  queryable: SqlStatement<unknown>,
): StatementEncoder & QueryDecoder<unknown> {
  if (typeof queryable === "string") return new TextSqlStatementEncoder(queryable);
  if ("calculateParseByteLength" in queryable) return queryable;
  if (queryable.args) {
    return new TextSqlStatementEncoder(queryable.sqlStatement, queryable.args, new Map());
  }
  return new TextSqlStatementEncoder(queryable.sqlStatement);
}
