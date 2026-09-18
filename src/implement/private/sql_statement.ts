import type { SqlStatement, TypedSqlStatement, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { createTypeSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";

export function sqlStatementToSqlEncoder(
  queryable: SqlStatement<unknown> | TypedSqlStatementEncoder,
  options?: Pick<TypedSqlStatement, "columnDecoders" | "typeDecoders">,
): TypedSqlStatementEncoder {
  if (typeof queryable === "string" || queryable instanceof Uint8Array) {
    const encoder = createTypeSqlStatementEncoder(queryable);
    encoder.typeDecoders = options?.typeDecoders ?? PG_DATA_DECODER_V1;
    encoder.columnDecoders = options?.columnDecoders;
    return encoder;
  } else if ("calculateParseByteLength" in queryable) return queryable; //忽略 options

  const encoder = createTypeSqlStatementEncoder(queryable.sqlStatement, queryable.textArgs);
  encoder.typeDecoders = queryable.typeDecoders ?? options?.typeDecoders ?? PG_DATA_DECODER_V1;
  encoder.columnDecoders = queryable.columnDecoders ?? options?.columnDecoders;

  return encoder;
}
