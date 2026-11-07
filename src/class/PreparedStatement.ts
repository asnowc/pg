import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";
import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "@/interface/Query/QueryReader.ts";
import { calcCStringByteLength } from "@/_utils/string.ts";

function templateStringsArrayToTemplate(chunks: ReadonlyArray<string>) {
  let template = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    template += `$${i}`;
    template += chunks[i];
  }
  return template;
}
function calcArgsTotalByteLength(argsEncoders: JsDataEncoder[], args: unknown[]) {
  let byteLength = 0;
  for (let i = 0; i < argsEncoders.length; i++) {
    if (args[i] === null) continue;
    const encoder = argsEncoders[i];
    byteLength += "byteLength" in encoder ? encoder.byteLength : encoder.startEncode(args[i]).byteLength;
  }
  return byteLength;
}

/**
 * 保存 SQL、参数及其编码器。参数与编码器必须一一对应；NULL 不编码。
 * @public
 * @since 0.3.0
 */
export class PreparedStatement {
  constructor(
    sqlStatement: string | ReadonlyArray<string> | Uint8Array,
    options: { args?: unknown[]; argsEncoders?: JsDataEncoder[]; statementName?: string } = {},
  ) {
    const { args, argsEncoders, statementName } = options;
    this.args = args;
    this.argsEncoders = argsEncoders;
    this.statementName = statementName;
    if (sqlStatement instanceof Array) {
      sqlStatement = templateStringsArrayToTemplate(sqlStatement);
    }
    if (typeof sqlStatement === "string") {
      this.statementByteLength = calcCStringByteLength(sqlStatement);
    } else {
      if (sqlStatement.includes(0)) throw new Error("PostgreSQL strings cannot contain NUL bytes");
      this.statementByteLength = sqlStatement.byteLength;
    }
    this.statementNameLength = this.statementName ? calcCStringByteLength(this.statementName) : 0;
    this.sqlStatement = sqlStatement;
    if (args) {
      if (!this.argsEncoders || this.argsEncoders.length !== args.length) {
        throw new Error("Mismatch between args and argsEncoders length");
      }
      this.argsTotalByteLength = calcArgsTotalByteLength(this.argsEncoders, args);
      this.argsLength = args.length;
    } else {
      this.argsTotalByteLength = 0;
      this.argsLength = 0;
    }
  }

  readonly args?: unknown[];
  readonly argsEncoders?: JsDataEncoder[];
  readonly statementName?: string;
  readonly statementNameLength: number;
  readonly sqlStatement: string | Uint8Array;
  readonly statementByteLength: number;
  readonly argsLength: number;
  readonly argsTotalByteLength: number;
}
/**
 * 保存 SQL 参数和结果列解码器，并携带结果行类型。
 * @public
 * @since 0.3.0
 */
export class TypedSqlStatement<T = unknown> extends PreparedStatement {
  constructor(
    sqlStatement: string | ReadonlyArray<string> | Uint8Array,
    options: {
      args?: unknown[];
      argsEncoders?: JsDataEncoder[];
      statementName?: string;
      getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
    } = {},
  ) {
    super(sqlStatement, options);
    if (typeof options.getResultDecoder === "function") {
      this.getResultDecoder = options.getResultDecoder;
    }
  }
  __infer?(value: T): void;
  /**
   * 每个结果列调用一次；省略时跳过解码。
   */
  getResultDecoder?(field: FieldInfo): PgColumnDataDecoder;
}

/**
 * 推断查询结果的类型
 * @public
 * @since 0.3.0
 */
export type InferQueryResult<T> = T extends { __infer?(value: infer P): unknown } ? P : unknown;
