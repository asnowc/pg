import { PgOid } from "@/util/pg_oid.ts";
import { json, jsonb } from "./decoder/json.ts";
import { inet, macaddr } from "./decoder/network.ts";
import {
  int64,
  boolean,
  float32,
  float64,
  numeric,
  int32,
  uInt64,
  uInt32,
} from "./decoder/numeric.ts";
import { date, time, timestamp, timestamptz, timetz } from "./decoder/datetime.ts";
import { bitText, bytea, char, text, uuid } from "./decoder/text.ts";
import type { PgColumnDataDecoder, PgColumnDecoder } from "@/interface/pg_data_decoder.ts";
const voidDecoder: PgColumnDataDecoder<undefined> = {
  decodeText: (value: string) => undefined,
  decodeBinary: () => undefined,
};
/**
 * 默认列解码器映射；函数条目需为每列调用一次，以隔离分段解码状态。
 * date、timestamp 和 timestamptz 的无穷值返回数字 Infinity 或 -Infinity，有限值返回对应的 Temporal 对象。
 * @public
 * @since 0.3.0
 */
export const PG_DATA_DECODER_V1: ReadonlyMap<number, PgColumnDecoder<unknown>> = createDataDecoderV1();

/** @__NO_SIDE_EFFECTS__ */
function createDataDecoderV1(): ReadonlyMap<number, PgColumnDecoder<unknown>> {
  const map = new Map<number, PgColumnDecoder<unknown>>();
  map.set(PgOid.BOOL, boolean);
  map.set(PgOid.BYTEA, bytea);
  map.set(PgOid.CHAR, char);
  map.set(PgOid.NAME, text);
  map.set(PgOid.INT8, int64);
  map.set(PgOid.INT2, int32);
  map.set(PgOid.INT4, int32);
  map.set(PgOid.TEXT, text);
  map.set(PgOid.OID, uInt32);
  map.set(PgOid.XID, uInt32);
  map.set(PgOid.XID8, uInt64);
  map.set(PgOid.FLOAT4, float32);
  map.set(PgOid.FLOAT8, float64);
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
  map.set(PgOid.BIT, bitText);
  map.set(PgOid.VARBIT, bitText);
  map.set(PgOid.REGCLASS, uInt32);
  map.set(PgOid.INET, inet);
  map.set(PgOid.MACADDR, macaddr);
  map.set(PgOid.MACADDR8, macaddr);
  map.set(PgOid.VOID, voidDecoder);
  map.set(PgOid.UNKNOWN, text);
  return map;
}
