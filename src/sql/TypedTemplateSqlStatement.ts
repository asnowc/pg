import { TypedSqlStatement } from "@/class.ts";
import { JsDataEncoder, JSDataEncoderMap } from "@/interface/js_data_encoder.ts";
import { getJsDataEncoder } from "@/codec/js_data_encoder.ts";
import { PgColumnDataDecoder, PgColumnDecoder } from "@/interface/pg_data_decoder.ts";
import { FieldInfo } from "@/interface/Query.ts";
import { NoDecoderError } from "@/_utils/error.ts";

export let createTypedTemplateSqlStatement: <T>(
  chunks: TemplateStringsArray,
  args: unknown[],
  encoderMap: JSDataEncoderMap,
  decoder: ReadonlyMap<number, PgColumnDecoder<unknown>>,
) => TypedTemplateSqlStatement<T>;

/**
 * SQL 模板语句；普通参数单独绑定，raw 片段直接嵌入 SQL。
 * @public
 * @since 0.3.0
 */
export class TypedTemplateSqlStatement<T = unknown> extends TypedSqlStatement<T> {
  static #createTypedTemplateSqlStatement<T>(
    chunks: ReadonlyArray<string>,
    args: unknown[],
    encoderMap: JSDataEncoderMap,
    decoderMap: ReadonlyMap<number, PgColumnDecoder<unknown>>,
  ) {
    return new TypedTemplateSqlStatement<T>(chunks, args, encoderMap, decoderMap);
  }
  static {
    createTypedTemplateSqlStatement = this.#createTypedTemplateSqlStatement;
  }
  private constructor(
    chunks: ReadonlyArray<string>,
    args: unknown[],
    encoderMap: JSDataEncoderMap,
    decoderMap: ReadonlyMap<number, PgColumnDecoder<unknown>>,
  ) {
    const init = initTemplateStringsArray(chunks, args);
    super(init.chunks, {
      args: init.args,
      argsEncoders: init.args.map((arg) => arg === null ? nullEncoder : getJsDataEncoder(encoderMap, arg)),
    });
    this.#chunks = init.chunks;
    this.#decoderMap = decoderMap;
  }
  #decoderMap: ReadonlyMap<number, PgColumnDecoder<unknown>>;
  #chunks: ReadonlyArray<string>;
  #sql?: string;
  /**
   * 返回包含参数占位符的 SQL 模板，raw 片段直接嵌入。
   */
  toTemplate(): string {
    return this.sqlStatement.toString();
  }
  /**
   * 返回参数已转换为 SQL 字面量的语句。
   */
  toSql(): string {
    if (!this.#sql) {
      this.#sql = templateStringsArrayToSql(this.#chunks, this.args ?? [], this.argsEncoders ?? []);
    }
    return this.#sql;
  }
  override getResultDecoder(field: FieldInfo): PgColumnDataDecoder {
    const decoder = this.#decoderMap.get(field.typeOID);
    if (!decoder) throw new NoDecoderError(field.typeOID, field.name, field.index);
    if (typeof decoder === "function") return decoder();
    return decoder;
  }
  override toString(): string {
    return this.toSql();
  }
}

const nullEncoder: JsDataEncoder = {
  oid: 0,
  byteLength: 0,
  encodeInto() {},
  encodeToText: () => "NULL",
};

function templateStringsArrayToSql(chunks: ReadonlyArray<string>, args: unknown[], encoders: JsDataEncoder[]) {
  let template = chunks[0];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const encoder = encoders[i];
    template += arg === null ? "NULL" : encoder.encodeToText(arg);
    template += chunks[i + 1];
  }
  return template;
}
/**
 * 把 String 对象参数直接嵌入 SQL，其他参数保留占位符。
 */
function initTemplateStringsArray(
  input: ReadonlyArray<string>,
  args: unknown[],
): { chunks: ReadonlyArray<string>; args: unknown[] } {
  const newChunks: string[] = [input[0]];
  const newArgs: unknown[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] instanceof String) {
      newChunks[newChunks.length - 1] += args[i] + input[i + 1];
    } else {
      newArgs.push(args[i]);
      newChunks.push(input[i + 1]);
    }
  }
  return { chunks: newChunks, args: newArgs };
}
