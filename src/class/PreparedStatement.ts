import type { JsDataEncoder2 } from "@/interface/js_data_encoder.ts";

/** @public */
export class PreparedStatement {
  constructor(
    readonly sqlStatement: string | Uint8Array,
    readonly args?: unknown[],
    readonly argsEncoders?: JsDataEncoder2[],
    readonly statementName?: string,
  ) {}
  declare readonly statementNameByteLength: number;
  declare readonly statementByteLength: number;

  declare readonly argsTotalByteLength: number;
}
