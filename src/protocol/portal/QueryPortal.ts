import { DataRowDecoder, decodeCommandComplete, DecodeRowDescriptionResult } from "../decode.ts";
import { ReceiverType } from "./QueryTask.ts";
import { ReadableBuffer } from "@/internal/ReadBuffer.ts";
import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";
import { skipData } from "../parsers/_common.ts";
import { FieldInfo } from "@/interface/Query.ts";

export interface QueryPortalOptions {
  onNotice?: (info: { notice: string }) => void;
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
  resolve?: (data: QueryParserResult<any>) => void;
  reject?: (error: unknown) => void;
}

export class QueryPortal<D = unknown> {
  private fields: DecodeRowDescriptionResult[] = [];
  private dataRowDecoder?: DataRowDecoder<Record<string, unknown>>;
  private failed = false;
  private rows: D[] = [];
  private notices: string[] = [];
  private rowCount: number | null = null;

  onNotice?: (info: { notice: string }) => void;
  getResultDecoder?: (field: FieldInfo) => PgColumnDataDecoder;
  readonly portalName?: string;

  constructor(
    readonly taskType: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery,
    options: QueryPortalOptions,
  ) {
    this.resolve = options.resolve;
    this.reject = options.reject;
    this.onNotice = options.onNotice;
    this.getResultDecoder = options.getResultDecoder;
  }
  resolve?: (resolver: QueryParserResult<D>) => void;
  reject?: (reason: unknown) => void;
  setFields(fields: DecodeRowDescriptionResult[]) {
    this.fields = fields;
    const statement = this.getResultDecoder;
    if (!statement) return;
    const decoders: PgColumnDataDecoder[] = fields.map((item) => statement(item));
    this.dataRowDecoder = new DataRowDecoder(decoders, fields);
  }
  finish(completed: boolean) {
    this.resolve?.({
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
      this.reject?.(error);
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
export type QueryParserResult<T = unknown> = {
  readonly rows: T[];
  readonly notices: string[];
  readonly rowCount: number | null;
  readonly fields: Readonly<DecodeRowDescriptionResult>[];
  readonly completed: boolean;
};
