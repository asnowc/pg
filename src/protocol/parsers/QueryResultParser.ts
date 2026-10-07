import type { ColumnDecoder, FieldInfo, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import {
  decodeCommandComplete,
  decodeDataRow,
  decodeRowDescription,
  DescribeTarget,
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
  FRAME,
  PgFieldDescription,
  PgFormat,
} from "@/protocol.ts";
import { decodeUTF16String } from "@/_utils/string.ts";
import { StreamWriter } from "@/_utils/StreamWriter.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import { ReceiverType } from "./QueryTask.ts";
import { LinkList } from "@/_utils/LinkList.ts";

export class QueryResultParser<T = unknown> {
  constructor(
    readonly resolve: (resolver: QueryResultParser<T>) => void,
    readonly reject: (reason: unknown) => void,
    readonly decoder: TypedSqlStatementEncoder<unknown>,
    readonly type: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery = ReceiverType.ExtendedQuery,
  ) {
  }
  descriptions?: PgFieldDescription[];
  fields?: Readonly<FieldInfo>[];
  rows: T[] = [];
  notices: string[] = [];
  rowCount?: number;
  dataRow(body: Uint8Array) {
    if (!this.descriptions) throw new PgProtocolError("Row description is missing");
    const values = decodeDataRow(body);
    const data = decodeRow(values, this.descriptions, this.decoder);
    this.rows.push(data as T);
  }
  rowDescription(body: Uint8Array) {
    this.descriptions = decodeRowDescription(body);
    this.fields = this.descriptions.map((description, index) => ({ ...description, index }));
  }
  commandComplete(body: Uint8Array) {
    this.rowCount = decodeRowCount(decodeCommandComplete(body));
  }
}

export class SampleQueryResultParser extends QueryResultParser {
  constructor(
    resolve: (resolver: QueryResultParser) => void,
    reject: (reason: unknown) => void,
    decoder: TypedSqlStatementEncoder<unknown>,
  ) {
    super(resolve, reject, decoder, ReceiverType.SimpleQuery);
  }
  #link = new LinkList<QueryResultParser>();
  override commandComplete(body: Uint8Array): void {
    super.commandComplete(body);
    const current = this.#link.head;
    if (current) this.#link.dequeue();
  }
}

export function sendExecuteWithResult(session: StreamWriter, statement: TypedSqlStatementEncoder, describe?: boolean) {
  session.pushData(encodeParseMessage(statement));
  session.pushData(encodeBindMessage(statement));
  if (describe) session.pushData(encodeDescribeMessage(DescribeTarget.Portal));
  session.pushData(encodeExecuteMessage(0));
  session.pushData(FRAME.SYNC);
}

export function decodeRow<T>(
  values: (Uint8Array | null)[],
  descriptions: PgFieldDescription[],
  statement: TypedSqlStatementEncoder<unknown>,
): T {
  const columnDecoders = statement.columnDecoders;
  const typeDecoders = statement.typeDecoders;
  if (!columnDecoders && !typeDecoders) throw new Error("No decoders available for the query result");

  const row: Record<string, unknown> = {};
  let columnDecoder: ColumnDecoder | undefined;
  let key: string | number;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const description = descriptions[index];
    key = description.name ?? index;
    if (value === null) {
      row[key] = null;
      continue;
    }
    columnDecoder = typeof columnDecoders === "function"
      ? columnDecoders(description, index)
      : columnDecoders?.get(index);
    if (!columnDecoder) columnDecoder = typeDecoders!.get(description.typeOID);
    if (!columnDecoder) throw new Error(`No decoder found for column ${description.name} at index ${index}`);

    row[key] = decodeColumn(value, description, columnDecoder);
  }
  return row as T;
}

function decodeColumn<T>(value: Uint8Array, fieldInfo: PgFieldDescription, decoder: ColumnDecoder<T>): T {
  return fieldInfo.format === PgFormat.binary
    ? decoder.decodeBinary(value, fieldInfo)
    : decoder.decodeText(decodeUTF16String(value), fieldInfo);
}

export function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
