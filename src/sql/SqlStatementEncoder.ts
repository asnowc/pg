import type { SimpleQueryEncoder, StatementEncoder } from "@/interface/Query.ts";
import { getJsDataEncoder } from "@/codec/js_data_encoder.ts";
import type { JsDataEncoder, JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { calcUTF16ByteLength } from "@/_utils/string.ts";

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
    return calcParseByteLength(this.#chunks);
  }

  encodeParseInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
  }
  calculateBindByteLength(): number {
    throw new Error("Method not implemented.");
  }
  encodeBindInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
  }
  calculateByteLength(): number {
    throw new Error("Method not implemented.");
  }
  encodeQueryInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
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
      if (args[i] instanceof String) {
        template += args[i];
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
    let encoder: JsDataEncoder;
    for (let i = 1; i < chunks.length; i++) {
      arg = args[i - 1];
      if (arg === null) template += "NULL";
      else {
        encoder = getJsDataEncoder(encoderMap, arg);
        template += encoder.text(arg, encoder.getOid(arg));
      }
      template += chunks[i];
    }
    this.#stringified = template;
    return template;
  }
}

function calcParseByteLength(chunks: readonly string[]) {
  let sqlByteLength = calcUTF16ByteLength(chunks[0]);
  for (let i = 1; i < chunks.length; i++) {
    sqlByteLength += 1 + calcUTF8UInt16ByteLength(i); // $n
    sqlByteLength += calcUTF16ByteLength(chunks[i]);
  }
  // UTF8 SQL + 1(CSTRING_TERMINATOR) + UTF8 statement + 1(CSTRING_TERMINATOR) + UInt16(argsLength) + OID * argsLength
  // statement='', argsLength=0 =>  length = sqlByteLength + 4
  return sqlByteLength + 4;
}
function calcUTF8UInt16ByteLength(n: number) {
  if (n < 0) throw new RangeError("Value must be non-negative");
  if (n < 10) return 1;
  if (n < 100) return 2;
  if (n < 1000) return 3;
  if (n < 10000) return 4;
  if (n <= 0xffff) return 4;
  throw new RangeError("PostgresSQL parameter must be less than or equal to 0xffff");
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
    //TODO
    throw new Error("Method not implemented.");
  }
  encodeParseInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
  }
  calculateBindByteLength(): number {
    throw new Error("Method not implemented.");
  }
  encodeBindInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
  }
  calculateByteLength(): number {
    throw new Error("Method not implemented.");
  }
  encodeQueryInto(data: Uint8Array, offset: number): number {
    throw new Error("Method not implemented.");
  }
  toTemplate(): string {
    return this.#sqlStatement;
  }
}
