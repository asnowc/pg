import type { SqlStatement } from "@/interface/Query.ts";
import { PreparedStatement, TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";

export function createTypedSqlStatement(
  queryable: SqlStatement | PreparedStatement | TypedSqlStatement,
  options?: QueryOptionsWithDecoder,
): TypedSqlStatement {
  if (typeof queryable === "string" || queryable instanceof Uint8Array) {
    return new TypedSqlStatement(queryable, options);
  } else if (queryable instanceof TypedSqlStatement) return queryable;
  return {
    args: queryable.args,
    argsEncoders: queryable.argsEncoders,
    statementName: queryable.statementName,
    statementNameLength: queryable.statementNameLength,
    argsLength: queryable.argsLength,
    getResultDecoder: options?.getResultDecoder,
    argsTotalByteLength: queryable.argsTotalByteLength,
    sqlStatement: queryable.sqlStatement,
    statementByteLength: queryable.statementByteLength,
  };
}
