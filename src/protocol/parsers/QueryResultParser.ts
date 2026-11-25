import { DataRowDecoder, decodeCommandComplete, DecodeRowDescriptionResult } from "../decode.ts";
import { QueryParserResult, ReceiverType } from "./QueryTask.ts";
import { ReadableBuffer } from "@/_utils/ReadBuffer.ts";
import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import { skipData } from "./_common.ts";

export class QueryResultParser<D = unknown> {
  private fields: DecodeRowDescriptionResult[] = [];
  private dataRowDecoder?: DataRowDecoder<Record<string, unknown>>;
  private failed = false;
  private rows: D[] = [];
  private notices: string[] = [];
  private rowCount: number | null = null;

  constructor(
    public resolve: (resolver: QueryParserResult<D>) => void = () => {},
    public reject: (reason: unknown) => void = () => {},
    readonly getResultDecoder?: (info: DecodeRowDescriptionResult) => PgColumnDataDecoder,
    readonly taskType?: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery,
  ) {
    this.#resolve = resolve;
  }
  #resolve: (resolver: QueryParserResult<D>) => void;
  setFields(fields: DecodeRowDescriptionResult[]) {
    this.fields = fields;
    const statement = this.getResultDecoder;
    if (!statement) return;
    const decoders: PgColumnDataDecoder[] = fields.map((item) => statement(item));
    this.dataRowDecoder = new DataRowDecoder(decoders, fields);
  }
  finish(completed: boolean) {
    this.#resolve({
      completed: completed,
      notices: this.notices,
      rows: this.rows,
      fields: this.fields,
      rowCount: this.rowCount,
    });
  }
  reset() {
    this.rows = [];
    this.notices = [];
    this.rowCount = null;
    this.failed = false;
  }

  dataRow(reader: ReadableBuffer, remainingByteLength: number): void {
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

  commandComplete(body: Uint8Array) {
    this.rowCount = decodeRowCount(decodeCommandComplete(body));
    this.finish(true);
  }
  emptyQueryResponse(): void {
    this.rowCount = 0;
    this.finish(true);
  }
  portalSuspended(): void {
    this.finish(false);
  }
}

function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
