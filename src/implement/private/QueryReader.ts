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
import { readLength } from "@/_utils/ByteStream.ts";
import { PgDatabaseError } from "@/error.ts";
import { PG_DATA_DECODER_V1 } from "@/codec/pg_data_decoder.ts";
import { decodeUTF16String } from "@/_utils/string.ts";
import type { PgFieldDescription } from "@/protocol/messages.ts";
import type { QueryDecoder } from "@/interface/Query.ts";

export default class QueryReader<T = unknown> implements IQueryReader<T> {
  constructor(
    session: PgSession | (() => Promise<PgSession>),
    statement: StatementEncoder & QueryDecoder<unknown>,
    release: (session: PgSession) => void = () => {},
    options: QueryOptions = {},
  ) {
    this.#source = { getSession: session, statement };
    this.#release = release;
    this.#options = options;
  }
  #source?: {
    getSession: PgSession | (() => Promise<PgSession>);
    statement: StatementEncoder & QueryDecoder<unknown>;
  };
  readonly #release: (session: PgSession) => void;
  readonly #options: QueryOptions;
  async #getSession() {
    const source = this.#source;
    if (!source) throw new Error("QueryReader has already been consumed");
    this.#source = undefined;
    const session = typeof source.getSession === "function" ? await source.getSession() : source.getSession;
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
    const { session, statement } = await this.#getSession();
    let synchronized = false;
    try {
      const collecting = collectQueryResult<T>(session, statement, this.#options);
      await sendExecuteWithResult(session, statement, true);
      const result = await collecting;
      synchronized = true;
      return result;
    } catch (error) {
      if (error instanceof SynchronizedQueryError) synchronized = true;
      throw error instanceof SynchronizedQueryError ? error.cause : error;
    } finally {
      if (synchronized) this.#release(session);
    }
  }
}

async function sendExecuteWithResult(session: PgSession, statement: StatementEncoder, describe?: boolean) {
  await session.write(encodeParseMessage(statement));
  await session.write(encodeBindMessage(statement));
  if (describe) await session.write(encodeDescribeMessage(DescribeTarget.Portal));
  await session.write(encodeExecuteMessage(0));
  await session.write(FRAME.SYNC);
}

type CollectedQueryResult<T> = {
  rows: T[];
  fields: readonly Readonly<FieldInfo>[];
  notices: string[];
  rowCount: number;
};

async function collectQueryResult<T>(
  session: PgSession,
  statement: QueryDecoder<unknown>,
  options: QueryOptions,
): Promise<CollectedQueryResult<T>> {
  const rows: T[] = [];
  const notices: string[] = [];
  let descriptions: PgFieldDescription[] = [];
  let fields: readonly Readonly<FieldInfo>[] = [];
  let rowCount = 0;
  let databaseError: PgDatabaseError | undefined;

  await session.subscribe({
    onMessage: async (reader, type, length) => {
      const body = await readLength(reader, length);
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
        case BackendMessageCode.Error: {
          const message = decodeError(body);
          databaseError = new PgDatabaseError(message.fields);
          break;
        }
        case BackendMessageCode.ReadyForQuery:
          session.transactionStatus = decodeReadyForQuery(body);
          session.removeSubscriber();
          break;
        default:
          break;
      }
    },
  });

  if (databaseError) throw new SynchronizedQueryError(databaseError);
  return { rows, fields, notices, rowCount };
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
