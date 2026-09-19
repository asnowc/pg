import { PgOid } from "@/util/pg_oid.ts";
import { json, jsonb } from "./decoder/json.ts";
import { inet, macaddr } from "./decoder/network.ts";
import { bigint, boolean, float, numeric, signedInteger, unsignedBigint, unsignedInteger } from "./decoder/numeric.ts";
import { date, time, timestamp, timestamptz, timetz } from "./decoder/datetime.ts";
import { bit, bytea, text, uuid } from "./decoder/text.ts";
import type { PgDataDecoder, PgDataDecoderMap } from "@/interface/pg_data_decoder.ts";

/** @public */
export const PG_DATA_DECODER_V1: PgDataDecoderMap = createDataDecoderV1();

/** @__NO_SIDE_EFFECTS__ */
function createDataDecoderV1(): PgDataDecoderMap {
  const map = new Map<number, PgDataDecoder>();
  map.set(PgOid.BOOL, boolean);
  map.set(PgOid.BYTEA, bytea);
  map.set(PgOid.CHAR, text);
  map.set(PgOid.NAME, text);
  map.set(PgOid.INT8, bigint);
  map.set(PgOid.INT2, signedInteger);
  map.set(PgOid.INT4, signedInteger);
  map.set(PgOid.TEXT, text);
  map.set(PgOid.OID, unsignedInteger);
  map.set(PgOid.XID, unsignedInteger);
  map.set(PgOid.XID8, unsignedBigint);
  map.set(PgOid.FLOAT4, float);
  map.set(PgOid.FLOAT8, float);
  map.set(PgOid.DATE, date);
  map.set(PgOid.TIME, time);
  map.set(PgOid.TIMESTAMP, timestamp);
  map.set(PgOid.TIMESTAMPTZ, timestamptz);
  map.set(PgOid.TIMETZ, timetz);
  map.set(PgOid.INTERVAL, text);
  map.set(PgOid.NUMERIC, numeric);
  map.set(PgOid.BPCHAR, text);
  map.set(PgOid.VARCHAR, text);
  map.set(PgOid.XML, text);
  map.set(PgOid.JSON, json);
  map.set(PgOid.JSONB, jsonb);
  map.set(PgOid.UUID, uuid);
  map.set(PgOid.BIT, bit);
  map.set(PgOid.VARBIT, bit);
  map.set(PgOid.REGCLASS, unsignedInteger);
  map.set(PgOid.INET, inet);
  map.set(PgOid.MACADDR, macaddr);
  map.set(PgOid.MACADDR8, macaddr);
  map.set(PgOid.UNKNOWN, text);
  return map;
}
