import type { JsDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { PgDataDecoderMap } from "../interface/pg_data_decoder.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import { InternalTemplateSqlStatementEncoder, InternalTextSqlStatementEncoder } from "@/codec/StatementEncoder.ts";
import { ColumnDecoderGetter, ColumnDecoderMap } from "@/interface/Query/QueryStatement.ts";

export let getStatementEncoder: (
  statement: TypedSqlStatementEncoder,
) => InternalTemplateSqlStatementEncoder | InternalTextSqlStatementEncoder;

/** @public */
export class TypedSqlStatementEncoder<T = unknown> {
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
  readonly typeDecoders?: PgDataDecoderMap | undefined;
  readonly columnDecoders?: ColumnDecoderMap | ColumnDecoderGetter;
  toTemplate(): string {
    return this.#internal.toTemplate();
  }
  toString(): string {
    return this.#internal.toTemplate();
  }
  static {
    getStatementEncoder = (statement: TypedSqlStatementEncoder) => statement.#internal;
  }
  __infer?(input: T): never;
}
