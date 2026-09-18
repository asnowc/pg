import type { SqlStatement, StatementEncoder } from "@/interface/Query.ts";

export function sqlStatementToSqlEncoder(queryable: SqlStatement<unknown>): StatementEncoder {
  throw new Error("Not implemented");
}
