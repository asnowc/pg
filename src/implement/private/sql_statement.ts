import type { QueryOptions, SqlStatement } from "@/interface/Query.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import { PreparedStatement, TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { QueryOptionsWithDecoder } from "@/interface/Query/_internal.ts";

export function createTypedSqlStatement(
  queryable: SqlStatement | PreparedStatement,
  options?: QueryOptionsWithDecoder,
): TypedSqlStatement {
  if (typeof queryable === "string" || queryable instanceof Uint8Array) {
    return new TypedSqlStatement(queryable, undefined, undefined, options?.getResultDecoder);
  }
  return {
    argsLength: queryable.argsLength,
    getResultDecoder: options?.getResultDecoder,
    argsTotalByteLength: queryable.argsTotalByteLength,
    sqlStatement: queryable.sqlStatement,
    statementByteLength: queryable.statementByteLength,
  };
}
