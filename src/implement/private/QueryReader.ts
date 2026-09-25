import type { PgSession } from "@/protocol.ts";
import type {
  FieldInfo,
  QueryCompletion,
  QueryOptions,
  QueryReader as IQueryReader,
  QueryResult,
  StatementEncoder,
} from "@/interface/Query.ts";
import {
  BackendMessageCode,
  decodeCommandComplete,
  decodeDataRow,
  decodeError,
  decodeReadyForQuery,
  decodeRowDescription,
  DescribeTarget,
  encodeBindMessage,
  encodeDescribeMessage,
  encodeExecuteMessage,
  encodeParseMessage,
  FRAME,
  PgFormat,
} from "@/protocol.ts";
import { PgDatabaseError } from "@/error.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import { decodeUTF16String } from "@/_utils/string.ts";
import type { PgFieldDescription } from "@/protocol/messages.ts";
import type { QueryDecoder } from "@/interface/Query.ts";
import { QueryQueue } from "@/protocol/QueryQueue.ts";
import { BufferWriter } from "@/_utils/StreamWriter.ts";
import { BufferReader, StreamParser, StreamReader } from "@/_utils/StreamReader.ts";

export default class QueryReader<T = unknown> implements IQueryReader<T> {
  constructor(
    session: QueryQueue,
    statement: StatementEncoder & QueryDecoder<unknown>,
    options: QueryOptions = {},
  ) {
    this.#source = { getSession: session, statement };
    this.#options = options;
  }
  #source?: {
    getSession: QueryQueue;
    statement: StatementEncoder & QueryDecoder<unknown>;
  };
  readonly #options: QueryOptions;
  #getSession() {
    const source = this.#source;
    if (!source) throw new Error("QueryReader has already been consumed");
    this.#source = undefined;
    const session = source.getSession;
    return { session, statement: source.statement };
  }

  async getRowCount(): Promise<number> {
    return (await this.#consume()).rowCount;
  }
  async getResults(): Promise<QueryResult<T>> {
    const result = await this.#consume();
    return { rows: result.rows, fields: result.fields, notices: result.notices, rowCount: result.rowCount };
  }
  async getRows(): Promise<T[]> {
    return (await this.#consume()).rows;
  }
  async getFirstRow(): Promise<T | null> {
    return (await this.#consume()).rows[0] ?? null;
  }

  async getMap<K extends keyof T>(key: K): Promise<Map<T[K], T>> {
    const map = new Map<T[K], T>();
    for await (const item of this) {
      map.set(item[key], item);
    }
    return map;
  }
  then(onfulfilled?: () => void, onrejected?: (reason: unknown) => void): Promise<void> {
    return this.#consume().then(() => onfulfilled?.(), onrejected);
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, QueryCompletion, void> {
    const result = await this.#consume();
    yield* result.rows;
    return { rowCount: result.rowCount, notices: result.notices };
  }

  async #consume(): Promise<CollectedQueryResult<T>> {
    const { session, statement } = this.#getSession();
  }
}

function sendExecuteWithResult(session: BufferWriter, statement: StatementEncoder, describe?: boolean) {
  session.pushData(encodeParseMessage(statement));
  session.pushData(encodeBindMessage(statement));
  if (describe) session.pushData(encodeDescribeMessage(DescribeTarget.Portal));
  session.pushData(encodeExecuteMessage(0));
  session.pushData(FRAME.SYNC);
}

type CollectedQueryResult<T> = {
  rows: T[];
  fields: readonly Readonly<FieldInfo>[];
  notices: string[];
  rowCount: number;
};
class CollectedQueryResultImpl<T> implements StreamParser<CollectedQueryResult<T>> {
  constructor(readonly bodyLength: number) {
  }
  rows: T[] = [];
  fields: readonly Readonly<FieldInfo>[] = [];
  notices: string[] = [];
  rowCount = 0;
  next(reader: StreamReader): CollectedQueryResult<T> | undefined {
    while (reader.readableLength) {
      this.type ??= reader.readUInt8();
      if (reader.readableLength < 4) return;
      this.bodyLength ??= reader.readUInt32BE();
      this.onData(reader, this.type, this.bodyLength);
    }
  }
  async onData(reader: StreamReader, type: number, length: number) {
    switch (type) {
      case BackendMessageCode.RowDescription:
        descriptions = decodeRowDescription(body);
        fields = descriptions.map(toFieldInfo);
        break;
      case BackendMessageCode.DataRow:
        rows.push(decodeRow<T>(decodeDataRow(body), descriptions, fields, statement, options));
        break;
      case BackendMessageCode.CommandComplete:
        rowCount = decodeRowCount(decodeCommandComplete(body));
        break;
      default:
        break;
    }
  }
}

class SynchronizedQueryError extends Error {
  constructor(cause: PgDatabaseError) {
    super(cause.message, { cause });
  }
}

function toFieldInfo(description: PgFieldDescription, index: number): Readonly<FieldInfo> {
  return {
    index,
    name: description.name,
    typeId: description.dataTypeOid,
    typeSize: description.dataTypeSize,
    typeModifier: description.typeModifier,
  };
}

function decodeRow<T>(
  values: (Uint8Array | null)[],
  descriptions: PgFieldDescription[],
  fields: readonly Readonly<FieldInfo>[],
  statement: QueryDecoder<unknown>,
  options: QueryOptions,
): T {
  const row: Record<string, unknown> = {};
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const description = descriptions[index];
    const field = fields[index];
    row[field.name] = value === null ? null : decodeColumn(value, description, field, statement, options);
  }
  return row as T;
}

function decodeColumn(
  value: Uint8Array,
  description: PgFieldDescription,
  field: Readonly<FieldInfo>,
  statement: QueryDecoder<unknown>,
  options: QueryOptions,
): unknown {
  const columnDecoders = options.columnDecoders ?? statement.columnDecoders;
  const columnDecoder = typeof columnDecoders === "function" ? columnDecoders(field) : columnDecoders?.get(field.index);
  if (columnDecoder) {
    return description.format === PgFormat.binary
      ? columnDecoder.binary(value, field)
      : columnDecoder.text(decodeUTF16String(value), field);
  }

  const typeDecoders = options.typeDecoders ?? statement.typeDecoders ?? PG_DATA_DECODER_V1;
  const decoder = typeDecoders.get(field.typeId) ?? PG_DATA_DECODER_V1.get(field.typeId);
  if (!decoder) return description.format === PgFormat.binary ? value : decodeUTF16String(value);
  return description.format === PgFormat.binary
    ? decoder.decodeBinary(value, field)
    : decoder.decodeText(decodeUTF16String(value), field);
}

function decodeRowCount(commandTag: string): number {
  const match = / (\d+)\0?$/.exec(commandTag);
  return match ? Number(match[1]) : 0;
}
