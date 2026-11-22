import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import { DataRowDecoder, decodeCommandComplete, DecodeRowDescriptionResult } from "../decode.ts";
import { QueryParserResult, ReceiverType } from "./QueryTask.ts";
import { ReadableBuffer } from "@/_utils/ReadBuffer.ts";
import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import { skipData } from "./_common.ts";

export interface QueryResultParser {
  reject(error: unknown): void;
  readonly notices: string[];
  readonly taskType: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery;
  dataRow(reader: ReadableBuffer, remainingByteLength: number): void;

  commandComplete(body: Uint8Array): void;
  emptyQueryResponse(): void;
  portalSuspended(): void;
}

export class QueryResultRowParser<D = unknown> implements QueryResultParser, QueryParserResult {
  constructor(
    private readonly resolve: (resolver: QueryParserResult<D>) => void,
    readonly reject: (reason: unknown) => void,
    readonly statement: TypedSqlStatement<D>,
    readonly taskType: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery,
  ) {
  }
  fields?: DecodeRowDescriptionResult[];
  private dataRowDecoder?: DataRowDecoder<Record<string, unknown>>;
  private failed = false;
  rows: D[] = [];
  readonly notices: string[] = [];
  rowCount?: number;
  dataRow(reader: ReadableBuffer, remainingByteLength: number) {
    if (this.failed || !this.dataRowDecoder) return skipData(reader, remainingByteLength);
    let row: unknown;
    const start = reader.readableStart;
    try {
      row = this.dataRowDecoder.next(reader, remainingByteLength);
    } catch (error) {
      this.failed = true;
      this.reject(error);
      const remaining = remainingByteLength - (reader.readableStart - start);
      return skipData(reader, Math.max(0, remaining));
    }
    if (row === undefined) return;
    this.dataRowDecoder.reset();
    this.rows.push(row as D);
  }
  setFields(fields: DecodeRowDescriptionResult[]) {
    this.fields = fields;
    const statement = this.statement;
    if (!statement.getResultDecoder) return;
    const decoders: PgColumnDataDecoder[] = fields.map((item) => statement.getResultDecoder!(item));
    this.dataRowDecoder = new DataRowDecoder(decoders, fields);
  }

  completed: boolean = false;
  commandComplete(body: Uint8Array) {
    this.rowCount = decodeRowCount(decodeCommandComplete(body));
    this.completed = true;
    this.resolve(this);
  }
  emptyQueryResponse(): void {
    this.rowCount = 0;
    this.completed = true;
    this.resolve(this);
  }
  portalSuspended(): void {
    this.resolve(this);
  }
}

function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
