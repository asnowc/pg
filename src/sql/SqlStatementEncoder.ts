import type { JsDataEncoder2, JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { PgColumnDecoder } from "../interface/pg_data_decoder.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import { InternalTemplateSqlStatementEncoder, InternalTextSqlStatementEncoder } from "@/codec/StatementEncoder.ts";
import { TypedSqlStatement } from "@/interface/Query/QueryStatement.ts";
import { FieldInfo } from "../interface/Query/QueryReader.ts";

export class TypedSqlStatementEncoder<T = unknown> implements TypedSqlStatement<T> {
  constructor(chunks: string | Uint8Array, args?: (string | null)[]);
  constructor(chunks: readonly string[], args: unknown[], encoderMap: JsDataEncoderMap);
  constructor(chunks: string | Uint8Array | (readonly string[]), args?: unknown[], encoderMap?: JsDataEncoderMap) {
    if (typeof chunks === "string") {
      this.#internal = new InternalTextSqlStatementEncoder(chunks, args as (string | null)[]);
    } else if (chunks instanceof Uint8Array) {
      throw new Error("Uint8Array input is not supported yet."); //TODO: 支持 Uint8Array 输入
    } else {
      this.#internal = new InternalTemplateSqlStatementEncoder(chunks, args!, encoderMap!);
    }
    this.typeDecoders = PG_DATA_DECODER_V1;
  }
  #internal: InternalTemplateSqlStatementEncoder | InternalTextSqlStatementEncoder;
  getArgEncoder(value: unknown): JsDataEncoder2 {
  }
  getResultDecoder(field: FieldInfo, index: number): PgColumnDecoder {
  }
  toTemplate(): string {
    return this.#internal.toTemplate();
  }
  toString(): string {
    return this.#internal.toTemplate();
  }
}
