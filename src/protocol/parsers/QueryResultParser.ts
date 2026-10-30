import type { TypedSqlStatement } from "@/interface/Query.ts";
import {
  DataRowDecoder,
  decodeCommandComplete,
  DecodeRowDescriptionResult,
  RowDescriptionDecoder,
} from "@/protocol.ts";
import { NoDecoderError, PgProtocolError } from "@/_utils/error.ts";
import { ReceiverType } from "./QueryTask.ts";
import { LinkList } from "@/_utils/LinkList.ts";
import { StreamReader } from "@/_utils/StreamReader.ts";

export class QueryResultParser<T = unknown> {
  constructor(
    readonly resolve: (resolver: QueryResultParser<T>) => void,
    readonly reject: (reason: unknown) => void,
    readonly decoder: TypedSqlStatement<unknown>,
    readonly type: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery = ReceiverType.ExtendedQuery,
  ) {
  }
  fields?: DecodeRowDescriptionResult[];
  private readonly dataRowDecoder = new DataRowDecoder([], []);
  rows: T[] = [];
  notices: string[] = [];
  rowCount?: number;
  dataRow(reader: StreamReader, remainingByteLength: number) {
    if (!this.fields) {
      this.reject(new PgProtocolError("Row description is missing"));
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
    this.rows.push(row as T);
  }
  private readonly rowDescriptionDecoder = new RowDescriptionDecoder();
  rowDescription(reader: StreamReader, remainingByteLength: number) {
    const fields = this.rowDescriptionDecoder.next(reader);
    if (!fields) return;
    this.fields = fields;
    const decoders = fields.map((info, index) => {
      try {
        return this.decoder.getResultDecoder(info, index);
      } catch (error) {
        throw new NoDecoderError(info.typeOID, info.name, index);
      }
    });
    this.dataRowDecoder.start(decoders, fields);
  }
  commandComplete(body: Uint8Array) {
    this.rowCount = decodeRowCount(decodeCommandComplete(body));
  }
}

export class SampleQueryResultParser extends QueryResultParser {
  constructor(
    resolve: (resolver: QueryResultParser) => void,
    reject: (reason: unknown) => void,
    decoder: TypedSqlStatement<unknown>,
  ) {
    super(resolve, reject, decoder, ReceiverType.SimpleQuery);
  }
  #link = new LinkList<QueryResultParser>();
  override commandComplete(body: Uint8Array): void {
    super.commandComplete(body);
    if (this.#link.head) this.#link.shift();
  }
}

function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
