import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import {
  DataRowDecoder,
  decodeCommandComplete,
  DecodeRowDescriptionResult,
  RowDescriptionDecoder,
} from "@/protocol.ts";
import { ReceiverType } from "./QueryTask.ts";
import { StreamReader } from "@/_utils/StreamReader.ts";
import { PgColumnDataDecoder } from "@/interface/pg_data_decoder.ts";

export class QueryResultParser<D = unknown> {
  constructor(
    readonly resolve: (resolver: QueryResultParser<D>) => void,
    readonly reject: (reason: unknown) => void,
    readonly statement: TypedSqlStatement<D>,
    readonly taskType: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery,
  ) {
  }
  fields?: DecodeRowDescriptionResult[];
  private dataRowDecoder?: DataRowDecoder<Record<string, unknown>>;
  private failed = false;
  rows: D[] = [];
  notices: string[] = [];
  rowCount?: number;
  dataRow(reader: StreamReader, remainingByteLength: number) {
    if (this.failed || !this.dataRowDecoder) return this.skipData(reader, remainingByteLength);
    let row: unknown;
    const start = reader.readableStart;
    try {
      row = this.dataRowDecoder.next(reader, remainingByteLength);
    } catch (error) {
      this.failed = true;
      this.reject(error);
      const remaining = remainingByteLength - (reader.readableStart - start);
      return this.skipData(reader, Math.max(0, remaining));
    }
    if (row === undefined) return;
    this.dataRowDecoder.reset();
    this.rows.push(row as D);
  }
  private readonly rowDescriptionDecoder = new RowDescriptionDecoder();

  rowDescription(reader: StreamReader, remainingByteLength: number) {
    if (this.failed) return this.skipData(reader, remainingByteLength);
    const statement = this.statement;
    if (!statement.getResultDecoder) {
      return this.skipData(reader, remainingByteLength);
    }
    this.fields = this.rowDescriptionDecoder.next(reader);
    if (!this.fields) return;
    this.rowDescriptionDecoder.reset();
    const decoders: PgColumnDataDecoder[] = this.fields.map((item) => statement.getResultDecoder!(item));
    this.dataRowDecoder = new DataRowDecoder(decoders, this.fields);
  }
  private skipData(reader: StreamReader, remainingByteLength: number) {
    if (reader.readableLength < remainingByteLength) reader.readableStart = reader.readableEnd;
    else reader.readableStart += remainingByteLength;
  }
  commandComplete(body: Uint8Array) {
    this.rowCount = decodeRowCount(decodeCommandComplete(body));
  }
}

function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
