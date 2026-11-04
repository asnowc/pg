import { getJsDataEncoder } from "@/codec/js_data_encoder.ts";
import type { JsDataEncoder, JsDataEncoder2, JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { calcUTF16ByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";
import { encodeInt16BE, encodeInt32BE } from "@/_utils/number.ts";
import { TypedSqlStatement } from "@/interface/Query.ts";
import { PgColumnDataDecoder } from "../interface/pg_data_decoder.ts";
import { FieldInfo } from "../interface/Query/QueryReader.ts";

export class InternalTemplateSqlStatementEncoder<T = unknown> implements TypedSqlStatement<T> {
  constructor(chunks: readonly string[], args: unknown[], encoderMap: JsDataEncoderMap) {
    this.#chunks = chunks;
    this.args = args;
    this.#argEncoders = this.args.map((arg) => getJsDataEncoder(encoderMap, arg));
  }
  get sqlStatement(): string {
    return this.toTemplate();
  }
  #argEncoders: JsDataEncoder[];
  readonly args: unknown[];
  #chunks: ReadonlyArray<string>;
  getArgEncoder(value: unknown): JsDataEncoder2 {
  }
  getResultDecoder(field: FieldInfo): PgColumnDataDecoder {
  }

  #template?: string;
  toTemplate(): string {
    if (this.#template) {
      return this.#template;
    }

    const chunks = this.#chunks;
    const args = this.args;
    let template = chunks[0];
    let argOffset = 1;
    for (let i = 1; i < chunks.length; i++) {
      if (args[i - 1] instanceof String) {
        template += args[i - 1];
      } else {
        template += `$${argOffset++}`;
      }
      template += chunks[i];
    }
    this.#template = template;
    return template;
  }
  #stringified?: string;
  toString(): string {
    if (this.#stringified) return this.#stringified;
    const args = this.args;
    const chunks = this.#chunks;
    const encoderMap = this.#argEncoders;
    let template = chunks[0];

    let arg: unknown;
    for (let i = 1; i < chunks.length; i++) {
      arg = args[i - 1];
      if (arg === null) template += "NULL";
      else {
        const encoder = encoderMap[i - 1];
        const oid = typeof encoder.oid === "function" ? encoder.oid(arg) : encoder.oid;
        template += encoder.encodeToText(arg, oid);
      }
      template += chunks[i];
    }
    this.#stringified = template;
    return template;
  }
}

export class InternalTextSqlStatementEncoder<T = unknown> implements TypedSqlStatement<T> {
  constructor(sqlStatement: string, args?: undefined);
  constructor(sqlStatement: string, args: (string | null)[]);
  constructor(sqlStatement: string, args?: (string | null)[]) {
    this.sqlStatement = sqlStatement;
    this.args = args ?? [];
  }
  readonly sqlStatement: string;
  readonly args: (string | null)[];
  getArgEncoder(value: unknown): JsDataEncoder2 {
  }
  getResultDecoder(field: FieldInfo): PgColumnDataDecoder {
  }
  calculateParseByteLength(): number {
    const sqlByteLength = calcUTF16ByteLength(this.sqlStatement);
    return 1 + sqlByteLength + 1 + 2 + (this.args.length ?? 0) * 4;
  }

  encodeParseInto(data: Uint8Array, offset: number): number {
    // https://postgres.ac.cn/docs/current/protocol-message-formats.html#PROTOCOL-MESSAGE-FORMATS-PARSE
    // arg count 表示前端希望预先指定的参数数量，可以为0.
    // | statement name | statement text |arg count | arg OIDs...
    // |   C string     |   C string     |  int16   |  int32[]
    data[offset++] = 0;
    offset += encodeUTF16StringInto(this.sqlStatement, data.subarray(offset));
    data[offset++] = 0;
    const argsLength = this.args.length;
    offset += encodeInt16BE(data, offset, argsLength);
    for (let index = 0; index < argsLength; index++) offset += encodeInt32BE(data, offset, 0);
    return offset;
  }
  calculateBindByteLength(): number {
    let byteLength = 8;
    for (const value of this.args) {
      byteLength += 4 + (value === null ? 0 : calcUTF16ByteLength(value));
    }
    return byteLength;
  }
  encodeBindInto(data: Uint8Array, offset: number): number {
    data[offset++] = 0;
    data[offset++] = 0;
    offset += encodeInt16BE(data, offset, 0);
    const args = this.args;
    offset += encodeInt16BE(data, offset, args.length);
    for (const value of args) {
      if (value === null) {
        offset += encodeInt32BE(data, offset, -1);
      } else {
        const byteLength = calcUTF16ByteLength(value);
        offset += encodeInt32BE(data, offset, byteLength);
        offset += encodeUTF16StringInto(value, data.subarray(offset));
      }
    }
    offset += encodeInt16BE(data, offset, 0);
    return offset;
  }
  calculateQueryByteLength(): number {
    return calcUTF16ByteLength(this.sqlStatement) + 1;
  }
  encodeQueryInto(data: Uint8Array, offset: number): number {
    offset += encodeUTF16StringInto(this.sqlStatement, data.subarray(offset));
    data[offset++] = 0;
    return offset;
  }
  toTemplate(): string {
    return this.sqlStatement;
  }
}
