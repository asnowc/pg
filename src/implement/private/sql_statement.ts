import type { SqlStatement, TypedSqlStatement } from "@/interface/Query.ts";
import { TypedSqlStatementEncoder } from "@/sql/SqlStatementEncoder.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";

export function sqlStatementToSqlEncoder(
  queryable: SqlStatement | TypedSqlStatementEncoder,
): TypedSqlStatement {
  if (typeof queryable === "string" || queryable instanceof Uint8Array) {
    const encoder = new TypedSqlStatementEncoder(queryable);
    encoder.typeDecoders = options?.typeDecoders ?? PG_DATA_DECODER_V1;
    encoder.columnDecoders = options?.columnDecoders;
    return encoder;
  } else if ("calculateParseByteLength" in queryable) return queryable; //忽略 options

  const encoder = new TypedSqlStatementEncoder(queryable.sqlStatement, queryable.textArgs);
  encoder.typeDecoders = queryable.typeDecoders ?? options?.typeDecoders ?? PG_DATA_DECODER_V1;
  encoder.columnDecoders = queryable.columnDecoders ?? options?.columnDecoders;

  return encoder;
}
