import type { JsDataEncoder2 } from "@/interface/js_data_encoder.ts";
import type { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import type { FieldInfo } from "@/interface/Query/QueryReader.ts";

/** @public */
export class PreparedStatement {
  constructor(
    sqlStatement: string | TemplateStringsArray | Uint8Array,
    readonly args?: unknown[],
    readonly argsEncoders?: JsDataEncoder2[],
    readonly statementName?: string,
  ) {
    if (sqlStatement instanceof Array) {
      sqlStatement = sqlStatement.join("");
    }
    this.sqlStatement = sqlStatement;
    //需要确保 sqlStatement 不包含 \0
  }
  readonly sqlStatement: string | Uint8Array;
  declare readonly statementNameByteLength: number;
  declare readonly statementByteLength: number;

  declare readonly argsLength: number;
  declare readonly argsTotalByteLength: number;
}
/** @public */
export class TypedSqlStatement<T = unknown> extends PreparedStatement {
  getResultDecoder(field: FieldInfo): PgColumnDataDecoder {
    throw new Error("Method not implemented.");
  }
  checkRow?(value: T): void;
}

/**
 * 推断查询结果的类型
 * @public
 */
export type InferQueryResult<T> = T extends TypedSqlStatement<infer P> ? P : unknown;
