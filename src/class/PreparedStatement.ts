import type { JsDataEncoder } from "@/interface/js_data_encoder.ts";
import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "@/interface/Query/QueryReader.ts";
import { calcCStringByteLength } from "@/_utils/string.ts";

function templateStringsArrayToTemplate(chunks: TemplateStringsArray, args: unknown[]) {
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
  return template;
}
function calcArgsTotalByteLength(argsEncoders: JsDataEncoder[], args: unknown[]) {
  let byteLength = 0;
  for (let i = 0; i < argsEncoders.length; i++) {
    const encoder = argsEncoders[i];
    byteLength += "byteLength" in encoder ? encoder.byteLength : encoder.startEncode(args[i]).byteLength;
  }
  return byteLength;
}

/** @public */
export class PreparedStatement {
  constructor(
    sqlStatement: string | TemplateStringsArray | Uint8Array,
    readonly args?: unknown[],
    readonly argsEncoders?: JsDataEncoder[],
    readonly statementName?: string,
  ) {
    if (sqlStatement instanceof Array) {
      sqlStatement = templateStringsArrayToTemplate(sqlStatement, args ?? []);
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

  readonly statementNameLength: number;
  readonly sqlStatement: string | Uint8Array;
  readonly statementByteLength: number;
  readonly argsLength: number;
  readonly argsTotalByteLength: number;
}
/** @public */
export class TypedSqlStatement<T = unknown> extends PreparedStatement {
  constructor(
    sqlStatement: string | TemplateStringsArray | Uint8Array,
    args?: unknown[],
    argsEncoders?: JsDataEncoder[],
    statementName?: string,
    readonly getResultDecoder: (field: FieldInfo) => PgColumnDataDecoder = emptyDataDecoder,
  ) {
    super(sqlStatement, args, argsEncoders, statementName);
  }
  __infer?(value: T): void;
}

/**
 * 推断查询结果的类型
 * @public
 */
export type InferQueryResult<T> = T extends TypedSqlStatement<infer P> ? P : unknown;

function emptyDataDecoder(): PgColumnDataDecoder {
  return {
    decodeBinary: (reader, remaining) => {
      if (reader.readableLength < remaining) {
        reader.readableStart += reader.readableLength;
        return;
      }
      reader.readableStart += remaining;
      return "";
    },
    decodeText(value) {
      return value;
    },
  };
}
new TypedSqlStatement("SELECT 1");
