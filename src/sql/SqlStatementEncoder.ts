import type { SimpleQueryEncoder, StatementEncoder } from "@/query.ts";
import { getJsDataEncoder, type JsDataEncoder, type JsDataEncoderMap } from "./js_data_encoder.ts";

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
