import { TypedSqlStatement } from "@/class/PreparedStatement.ts";
import {
  DataRowDecoder,
  decodeCommandComplete,
  DecodeRowDescriptionResult,
  RowDescriptionDecoder,
} from "@/protocol.ts";
import { InternalError, NoDecoderError } from "@/_utils/error.ts";
import { QueryAction, ReceiverType } from "./QueryTask.ts";
import { StreamReader } from "@/_utils/StreamReader.ts";

export class QueryResultParser<D = unknown> {
  constructor(
    readonly resolve: (resolver: QueryResultParser<D>) => void,
    readonly reject: (reason: unknown) => void,
    readonly statement: TypedSqlStatement<D>,
    readonly taskType: QueryAction.ExtendedQuery | QueryAction.SimpleQuery,
  ) {
    if (taskType === QueryAction.ExtendedQuery) {
      this.type = ReceiverType.ExtendedQuery;
    } else {
      this.type = ReceiverType.SimpleQuery;
    }
  }
  readonly type: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery;
  fields?: DecodeRowDescriptionResult[];
  private dataRowDecoder?: DataRowDecoder<any>;
  rows: D[] = [];
  notices: string[] = [];
  rowCount?: number;
  dataRow(reader: StreamReader, remainingByteLength: number) {
    if (!this.dataRowDecoder) {
      this.reject(new InternalError("Row description is missing"));
      return;
    }
    let row: unknown;
    try {
      row = this.dataRowDecoder.next(reader, remainingByteLength);
    } catch (error) {
      this.reject(error);
      return;
    }
    if (!row) return;
    this.dataRowDecoder.reset();
    this.rows.push(row as D);
  }
  private readonly rowDescriptionDecoder = new RowDescriptionDecoder();
  rowDescription(reader: StreamReader, remainingByteLength: number) {
    const fields = this.rowDescriptionDecoder.next(reader);
    if (!fields) return;
    this.rowDescriptionDecoder.reset();
    this.fields = fields;
    const decoders = fields.map((info, index) => {
      try {
        return this.statement.getResultDecoder(info);
      } catch (error) {
        throw new NoDecoderError(info.typeOID, info.name, index);
      }
    });
    this.dataRowDecoder = new DataRowDecoder(decoders, fields);
  }
  commandComplete(body: Uint8Array) {
    this.rowCount = decodeRowCount(decodeCommandComplete(body));
  }
}

function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
