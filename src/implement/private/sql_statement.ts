import type { SqlStatement, TypedSqlStatement, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";

export function sqlStatementToSqlEncoder(
  queryable: SqlStatement<unknown> | TypedSqlStatementEncoder,
  options?: Pick<TypedSqlStatement, "columnDecoders" | "typeDecoders">,
): TypedSqlStatementEncoder {
  if (typeof queryable === "string" || queryable instanceof Uint8Array) {
    if (!options || !hasDecoders(options)) throw new Error("No column or type decoders provided.");
    const encoder = createTypeSqlStatementEncoder(queryable);
    encoder.typeDecoders = options.typeDecoders;
    encoder.columnDecoders = options.columnDecoders;
    return encoder;
  } else if ("calculateParseByteLength" in queryable) return queryable; //忽略 options

  if ((!options || !hasDecoders(options)) && hasDecoders(queryable)) {
    throw new Error("No column or type decoders provided.");
  }

  const encoder = createTypeSqlStatementEncoder(queryable.sqlStatement, queryable.textArgs);
  encoder.typeDecoders = queryable.typeDecoders ?? options?.typeDecoders;
  encoder.columnDecoders = queryable.columnDecoders ?? options?.columnDecoders;

  return encoder;
}
function getDecoders() {
}
function hasDecoders(options: Pick<TypedSqlStatement, "columnDecoders" | "typeDecoders">) {
  return !!(options.columnDecoders || options.typeDecoders);
}
