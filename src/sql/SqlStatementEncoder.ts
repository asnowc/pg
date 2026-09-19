import type { SimpleQueryEncoder, StatementEncoder } from "@/interface/Query.ts";
import { getJsDataEncoder } from "@/codec/js_data_encoder.ts";
import type { JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { calcUTF16ByteLength, encodeUTF16StringInto } from "@/_utils/string.ts";
import { encodeInt16BE, encodeInt32BE } from "@/_utils/number.ts";

/** @public */
export class TemplateSqlStatementEncoder implements StatementEncoder, SimpleQueryEncoder {
  constructor(chunks: TemplateStringsArray, args: unknown[], encoderMap: JsDataEncoderMap) {
    this.#chunks = chunks;
    this.#args = args;
    this.#encoderMap = encoderMap;
  }
  #encoderMap: JsDataEncoderMap;
  #args: unknown[];
  #chunks: TemplateStringsArray;
  calculateParseByteLength(): number {
    return this.#getEncoder().calculateParseByteLength();
  }

  encodeParseInto(data: Uint8Array, offset: number): number {
    return this.#getEncoder().encodeParseInto(data, offset);
  }
  calculateBindByteLength(): number {
    return this.#getEncoder().calculateBindByteLength();
  }
  encodeBindInto(data: Uint8Array, offset: number): number {
    return this.#getEncoder().encodeBindInto(data, offset);
  }
  calculateByteLength(): number {
    return this.#getEncoder().calculateByteLength();
  }
  encodeQueryInto(data: Uint8Array, offset: number): number {
    return this.#getEncoder().encodeQueryInto(data, offset);
  }

  calculateArgsByteLength(): number {
    throw new Error("Method not implemented.");
  }
  encodeArgsInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
  }
  encodeArgs(): Uint8Array {
    throw new Error("Method not implemented.");
  }

  #encoder?: TextSqlStatementEncoder;
  #getEncoder(): TextSqlStatementEncoder {
    if (this.#encoder) return this.#encoder;

    const args: (string | null)[] = [];
    for (let index = 0; index < this.#args.length; index++) {
      const value = this.#args[index];
      if (value instanceof String) continue;
      if (value === null) {
        args.push(null);
        continue;
      }
      const encoder = getJsDataEncoder(this.#encoderMap, value);
      const oid = typeof encoder.oid === "function" ? encoder.oid(value) : encoder.oid;
      args.push(encoder.encodeToText(value, oid));
    }
    this.#encoder = new TextSqlStatementEncoder(this.toTemplate(), args, this.#encoderMap);
    return this.#encoder;
  }

  #template?: string;
  toTemplate(): string {
    if (this.#template) {
      return this.#template;
    }

    const chunks = this.#chunks;
    const args = this.#args;
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
    if (this.#stringified) {
      return this.#stringified;
    }
    const args = this.#args;
    const chunks = this.#chunks;
    const encoderMap = this.#encoderMap;
    let template = chunks[0];

    let arg: unknown;
    for (let i = 1; i < chunks.length; i++) {
      arg = args[i - 1];
      if (arg === null) template += "NULL";
      else {
        const encoder = getJsDataEncoder(encoderMap, arg);
        const oid = typeof encoder.oid === "function" ? encoder.oid(arg) : encoder.oid;
        template += encoder.encodeToText(arg, oid);
      }
      template += chunks[i];
    }
    this.#stringified = template;
    return template;
  }
}

/** @public */
export class TextSqlStatementEncoder implements StatementEncoder, SimpleQueryEncoder {
  constructor(sqlStatement: string, args?: undefined);
  constructor(sqlStatement: string, args: (string | null)[], encoderMap: JsDataEncoderMap);
  constructor(sqlStatement: string, args?: (string | null)[], encoderMap?: JsDataEncoderMap) {
    this.#sqlStatement = sqlStatement;
    this.#args = args;
    this.#encoderMap = encoderMap;
  }
  #encoderMap?: JsDataEncoderMap;
  #sqlStatement: string;
  #args?: (string | null)[];
  calculateParseByteLength(): number {
    const sqlByteLength = calcUTF16ByteLength(this.#sqlStatement);
    return 1 + sqlByteLength + 1 + 2 + (this.#args?.length ?? 0) * 4;
  }
  encodeParseInto(data: Uint8Array, offset: number): number {
    data[offset++] = 0;
    offset += encodeUTF16StringInto(this.#sqlStatement, data.subarray(offset));
    data[offset++] = 0;
    const argsLength = this.#args?.length ?? 0;
    offset += encodeInt16BE(data, offset, argsLength);
    for (let index = 0; index < argsLength; index++) offset += encodeInt32BE(data, offset, 0);
    return offset;
  }
  calculateBindByteLength(): number {
    let byteLength = 8;
    for (const value of this.#args ?? []) {
      byteLength += 4 + (value === null ? 0 : calcUTF16ByteLength(value));
    }
    return byteLength;
  }
  encodeBindInto(data: Uint8Array, offset: number): number {
    data[offset++] = 0;
    data[offset++] = 0;
    offset += encodeInt16BE(data, offset, 0);
    const args = this.#args ?? [];
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
  calculateByteLength(): number {
    return calcUTF16ByteLength(this.#sqlStatement) + 1;
  }
  encodeQueryInto(data: Uint8Array, offset: number): number {
    offset += encodeUTF16StringInto(this.#sqlStatement, data.subarray(offset));
    data[offset++] = 0;
    return offset;
  }
  toTemplate(): string {
    return this.#sqlStatement;
  }
}
