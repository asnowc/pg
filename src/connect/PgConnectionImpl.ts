import type { FieldInfo, PgCursor, QueryCompletion, QueryReader, SampleQueryReader } from "@/query.ts";
import { PG_DATA_DECODER_V1, QueryReaderImpl, SampleQueryReaderImpl } from "@/query.ts";
import {
  BACKEND_MSG_CODE,
  decodeBackendMessage,
  encodeFrontendMessage,
  FRONTEND_MSG_CODE,
  PgFormat,
} from "@/protocol/pg_message.ts";
import type { PgBackendMessage, PgFieldDescription } from "@/protocol/pg_message.ts";
import type { ByteStream, PgMessageReader, PgSessionInfo } from "@/protocol.ts";
import { PgDatabaseError } from "./PgDatabaseError.ts";
import type {
  CopyFromHandle,
  CopyFromOptions,
  CopyToOptions,
  OpenCursorOptions,
  PgConnection,
  QueryOptions,
  SqlStatement,
  SqlStatements,
} from "./PgConnection.ts";

interface MaterializedResult<T = unknown> {
  rows: T[];
  fields: readonly FieldInfo[];
  notices: string[];
  rowCount: number;
}

export class PgConnectionImpl implements PgConnection {
  constructor(private stream: ByteStream, readonly session: PgSessionInfo, private reader: PgMessageReader) {}
  #queue = Promise.resolve();
  #closed = false;
  #cursorId = 0;

  get closed(): boolean {
    return this.#closed;
  }

  queryStream(options?: QueryOptions): ReadableWritablePair<SampleQueryReader, Uint8Array> {
    this.#assertOpen();
    const chunks: Uint8Array[] = [];
    const connection = this;
    return new TransformStream<Uint8Array, SampleQueryReader>({
      transform(chunk) {
        chunks.push(chunk.slice());
      },
      async flush(controller) {
        for await (const result of connection.simpleQuery(chunks, options)) controller.enqueue(result);
      },
    });
  }

  async *simpleQuery(
    queryable: SqlStatements | ReadableStream<Uint8Array>,
    options?: QueryOptions,
  ): AsyncIterable<SampleQueryReader> {
    const sql = queryable instanceof ReadableStream
      ? new TextDecoder().decode(await collectStream(queryable))
      : statementText(queryable);
    const results = await this.#enqueue(() => this.#simple(sql, options));
    yield* results.map((result) =>
      new SampleQueryReaderImpl(result.rows, result.fields, result.notices, result.rowCount)
    );
  }

  query<T>(queryable: SqlStatement<T>, options?: QueryOptions): QueryReader<T> {
    this.#assertOpen();
    const result = this.#enqueue(async () => {
      const results = isParameterized(queryable)
        ? await this.#extended<T>(queryable, options)
        : await this.#simple(statementText(queryable), options) as MaterializedResult<T>[];
      const value = results[0] ?? { rows: [], fields: [], notices: [], rowCount: 0 };
      return {
        rows: value.rows,
        fields: value.fields,
        completion: completion(value),
      };
    });
    return new QueryReaderImpl(result);
  }

  openCursor<T>(queryable: SqlStatement<T>, options?: OpenCursorOptions): PgCursor<T> {
    this.#assertOpen();
    const controller = new CursorController<T>();
    this.#enqueue(() => this.#runCursor(queryable, controller, options)).catch((error) => controller.fail(error));
    return new PgCursorImpl(controller, options?.iteratorMaxRows);
  }

  copyFrom(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle {
    this.#assertOpen();
    const ready = deferred<void>();
    const finish = deferred<{ failure?: string }>();
    const complete = deferred<{ rows: number }>();
    this.#enqueue(async () => {
      try {
        await this.#send({ type: FRONTEND_MSG_CODE.query, sql: statementText(queryable) });
        await this.#waitFor(BACKEND_MSG_CODE.copyInResponse, options);
        ready.resolve();
        const ending = await finish.promise;
        await this.#send(
          ending.failure
            ? { type: FRONTEND_MSG_CODE.copyFail, reason: ending.failure }
            : { type: FRONTEND_MSG_CODE.copyDone },
        );
        const result = await this.#drainCompletion(options);
        complete.resolve({ rows: result });
      } catch (error) {
        ready.reject(error);
        complete.reject(error);
        throw error;
      }
    }).catch(() => undefined);
    return new CopyFromHandleImpl(this, ready.promise, finish, complete.promise);
  }

  copyForm(queryable: SqlStatement<unknown>, options?: CopyFromOptions): CopyFromHandle {
    return this.copyFrom(queryable, options);
  }

  copyTo(queryable: SqlStatement<unknown>, options?: CopyToOptions): ReadableStream<Uint8Array> {
    this.#assertOpen();
    let cancelled = false;
    let resume = deferred<void>();
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#enqueue(async () => {
          await this.#send({ type: FRONTEND_MSG_CODE.query, sql: statementText(queryable) });
          let databaseError: PgDatabaseError | undefined;
          while (true) {
            const message = await this.#read();
            if (message.type === BACKEND_MSG_CODE.copyData && !cancelled) {
              if ((controller.desiredSize ?? 1) <= 0) {
                await resume.promise;
                resume = deferred<void>();
              }
              if (!cancelled) controller.enqueue(message.data);
            } else if (message.type === BACKEND_MSG_CODE.error) databaseError = new PgDatabaseError(message.fields);
            else if (isAsync(message)) await this.#async(message, options);
            else if (message.type === BACKEND_MSG_CODE.readyForQuery) {
              if (databaseError) throw databaseError;
              if (!cancelled) controller.close();
              return;
            }
          }
        }).catch((error) => !cancelled && controller.error(error));
      },
      pull() {
        resume.resolve();
      },
      cancel() {
        cancelled = true;
        resume.resolve();
      },
    });
  }

  async [Symbol.asyncDispose](): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#queue.catch(() => undefined);
    try {
      await this.#send({ type: FRONTEND_MSG_CODE.terminate }, true);
      await this.stream.closeWrite();
    } finally {
      this.stream.close();
    }
  }

  async writeCopyData(data: Uint8Array): Promise<void> {
    await this.#send({ type: FRONTEND_MSG_CODE.copyData, data });
  }

  async #simple(sql: string, options?: QueryOptions): Promise<MaterializedResult[]> {
    await this.#send({ type: FRONTEND_MSG_CODE.query, sql });
    return await this.#readResults(options);
  }

  async #extended<T>(queryable: Extract<SqlStatement<T>, { sqlTemplate: unknown }>, options?: QueryOptions) {
    const formats = normalizeFormats(queryable.argsFormat, queryable.args.length);
    await this.#send({
      type: FRONTEND_MSG_CODE.parse,
      statement: "",
      sql: statementText(queryable),
      parameterTypeOids: Array.from(queryable.argsOid ?? []),
    });
    await this.#send({
      type: FRONTEND_MSG_CODE.bind,
      portal: "",
      statement: "",
      parameters: Array.from(
        queryable.args,
        (value) => typeof value === "string" ? new TextEncoder().encode(value) : value,
      ),
      parameterFormats: formats,
      resultFormats: [PgFormat.text],
    });
    await this.#send({ type: FRONTEND_MSG_CODE.describe, target: "portal", name: "" });
    await this.#send({ type: FRONTEND_MSG_CODE.execute, portal: "", maxRows: 0 });
    await this.#send({ type: FRONTEND_MSG_CODE.sync });
    return await this.#readResults({ ...queryable, ...options }) as MaterializedResult<T>[];
  }

  async #runCursor<T>(
    queryable: SqlStatement<T>,
    controller: CursorController<T>,
    options?: OpenCursorOptions,
  ): Promise<void> {
    const id = ++this.#cursorId;
    const statement = `asla_statement_${id}`;
    const portal = `asla_portal_${id}`;
    const parameterized = isParameterized(queryable);
    const args = parameterized ? queryable.args : [];
    const formats = parameterized ? normalizeFormats(queryable.argsFormat, args.length) : [];
    await this.#send({
      type: FRONTEND_MSG_CODE.parse,
      statement,
      sql: statementText(queryable),
      parameterTypeOids: parameterized ? Array.from(queryable.argsOid ?? []) : [],
    });
    await this.#send({
      type: FRONTEND_MSG_CODE.bind,
      portal,
      statement,
      parameters: Array.from(args, (value) => typeof value === "string" ? new TextEncoder().encode(value) : value),
      parameterFormats: formats,
      resultFormats: [PgFormat.text],
    });
    await this.#send({ type: FRONTEND_MSG_CODE.describe, target: "portal", name: portal });
    await this.#send({ type: FRONTEND_MSG_CODE.flush });

    let descriptions: readonly PgFieldDescription[] = [];
    while (true) {
      const message = await this.#read();
      if (message.type === BACKEND_MSG_CODE.rowDescription) {
        descriptions = message.fields;
        controller.fields.resolve(toFields(descriptions));
        break;
      }
      if (message.type === BACKEND_MSG_CODE.noData) {
        controller.fields.resolve([]);
        break;
      }
      if (message.type === BACKEND_MSG_CODE.error) {
        await this.#recoverExtendedError();
        throw new PgDatabaseError(message.fields);
      }
      if (isAsync(message)) await this.#async(message, options);
    }

    const notices: string[] = [];
    while (true) {
      const request = await controller.next();
      if (request.type === "close") {
        await this.#send({ type: FRONTEND_MSG_CODE.close, target: "portal", name: portal });
        await this.#send({ type: FRONTEND_MSG_CODE.close, target: "statement", name: statement });
        await this.#send({ type: FRONTEND_MSG_CODE.sync });
        await this.#drainReady(options);
        controller.closed = true;
        controller.completion.resolve({ status: "closed", fields: await controller.fields.promise, notices });
        request.response.resolve();
        return;
      }

      await this.#send({ type: FRONTEND_MSG_CODE.execute, portal, maxRows: request.maxRows });
      await this.#send({ type: FRONTEND_MSG_CODE.flush });
      const rows: T[] = [];
      let commandTag: string | undefined;
      let databaseError: PgDatabaseError | undefined;
      while (true) {
        const message = await this.#read();
        if (message.type === BACKEND_MSG_CODE.dataRow) {
          rows.push(decodeRow(message.values, descriptions, options) as T);
        } else if (message.type === BACKEND_MSG_CODE.portalSuspended) {
          request.response.resolve(rows);
          break;
        } else if (message.type === BACKEND_MSG_CODE.commandComplete) {
          commandTag = message.tag;
          await this.#send({ type: FRONTEND_MSG_CODE.close, target: "statement", name: statement });
          await this.#send({ type: FRONTEND_MSG_CODE.sync });
          await this.#drainReady(options);
          controller.closed = true;
          controller.completion.resolve({
            status: "complete",
            rowCount: parseRowCount(commandTag, controller.rowsRead + rows.length),
            fields: await controller.fields.promise,
            notices,
          });
          request.response.resolve(rows);
          return;
        } else if (message.type === BACKEND_MSG_CODE.error) {
          databaseError = new PgDatabaseError(message.fields);
          await this.#recoverExtendedError();
          request.response.reject(databaseError);
          throw databaseError;
        } else if (message.type === BACKEND_MSG_CODE.notice) {
          notices.push(message.fields.message);
          await this.#async(message, options);
        } else if (isAsync(message)) {
          await this.#async(message, options);
        }
      }
    }
  }

  async #recoverExtendedError(): Promise<void> {
    await this.#send({ type: FRONTEND_MSG_CODE.sync });
    await this.#drainReady();
  }

  async #drainReady(options?: QueryOptions): Promise<void> {
    while (true) {
      const message = await this.#read();
      if (message.type === BACKEND_MSG_CODE.readyForQuery) {
        this.session.transactionStatus = message.status;
        return;
      }
      if (isAsync(message)) await this.#async(message, options);
    }
  }

  async #readResults(options?: QueryOptions): Promise<MaterializedResult[]> {
    const results: MaterializedResult[] = [];
    let current: MaterializedResult = { rows: [], fields: [], notices: [], rowCount: 0 };
    let descriptions: readonly PgFieldDescription[] = [];
    let databaseError: PgDatabaseError | undefined;
    while (true) {
      const message = await this.#read();
      switch (message.type) {
        case BACKEND_MSG_CODE.rowDescription:
          descriptions = message.fields;
          current.fields = toFields(descriptions);
          break;
        case BACKEND_MSG_CODE.dataRow:
          current.rows.push(decodeRow(message.values, descriptions, options));
          break;
        case BACKEND_MSG_CODE.commandComplete:
          current.rowCount = parseRowCount(message.tag, current.rows.length);
          results.push(current);
          current = { rows: [], fields: [], notices: [], rowCount: 0 };
          descriptions = [];
          break;
        case BACKEND_MSG_CODE.emptyQuery:
          results.push(current);
          current = { rows: [], fields: [], notices: [], rowCount: 0 };
          break;
        case BACKEND_MSG_CODE.notice:
          current.notices.push(message.fields.message);
          await options?.onNotice?.({ notice: message.fields.message });
          break;
        case BACKEND_MSG_CODE.error:
          databaseError = new PgDatabaseError(message.fields);
          break;
        case BACKEND_MSG_CODE.parameterStatus:
        case BACKEND_MSG_CODE.notification:
          await this.#async(message, options);
          break;
        case BACKEND_MSG_CODE.readyForQuery:
          this.session.transactionStatus = message.status;
          if (databaseError) throw databaseError;
          return results;
      }
    }
  }

  async #waitFor(type: BACKEND_MSG_CODE, options?: CopyFromOptions): Promise<void> {
    while (true) {
      const message = await this.#read();
      if (message.type === type) return;
      if (message.type === BACKEND_MSG_CODE.error) throw new PgDatabaseError(message.fields);
      if (isAsync(message)) await this.#async(message, options);
    }
  }

  async #drainCompletion(options?: CopyFromOptions): Promise<number> {
    let rows = 0;
    let databaseError: PgDatabaseError | undefined;
    while (true) {
      const message = await this.#read();
      if (message.type === BACKEND_MSG_CODE.commandComplete) rows = parseRowCount(message.tag, 0);
      else if (message.type === BACKEND_MSG_CODE.error) databaseError = new PgDatabaseError(message.fields);
      else if (isAsync(message)) await this.#async(message, options);
      else if (message.type === BACKEND_MSG_CODE.readyForQuery) {
        if (databaseError) throw databaseError;
        return rows;
      }
    }
  }

  async #read(): Promise<PgBackendMessage> {
    const pending = await this.reader.read();
    if (!pending) throw new Error("PostgreSQL connection closed unexpectedly");
    return decodeBackendMessage(pending.type, await pending.readBody());
  }

  async #async(message: PgBackendMessage, options?: QueryOptions): Promise<void> {
    if (message.type === BACKEND_MSG_CODE.parameterStatus) {
      (this.session.parameters as Record<string, string>)[message.name] = message.value;
    } else if (message.type === BACKEND_MSG_CODE.notice) {
      await options?.onNotice?.({ notice: message.fields.message });
    }
  }

  async #send(message: Parameters<typeof encodeFrontendMessage>[0], allowClosed = false): Promise<void> {
    if (this.#closed && !allowClosed) throw new Error("PgConnection is closed");
    for (const part of encodeFrontendMessage(message)) await this.reader.write(part);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) return Promise.reject(new Error("PgConnection is closed"));
    const result = this.#queue.then(operation).catch((error) => {
      if (!(error instanceof PgDatabaseError)) {
        this.#closed = true;
        this.stream.close();
      }
      throw error;
    });
    this.#queue = result.then(() => undefined, () => undefined);
    return result;
  }

  #assertOpen(): void {
    if (this.#closed) throw new Error("PgConnection is closed");
  }
}

export class PgCursorImpl<T> implements PgCursor<T> {
  constructor(private controller: CursorController<T>, private iteratorMaxRows = 100) {}
  #reading = false;
  get rowsRead(): number {
    return this.controller.rowsRead;
  }
  get isClosed(): boolean {
    return this.controller.closed;
  }
  async read(maxRows = this.iteratorMaxRows): Promise<T[]> {
    if (this.controller.closed) return [];
    if (!Number.isSafeInteger(maxRows) || maxRows <= 0) throw new RangeError("maxRows must be a positive integer");
    if (this.#reading) throw new Error("Cursor read is already in progress");
    this.#reading = true;
    try {
      const rows = await this.controller.read(maxRows);
      this.controller.rowsRead += rows.length;
      return rows;
    } finally {
      this.#reading = false;
    }
  }
  close(): Promise<void> {
    return this.controller.close();
  }
  getFields(): Promise<readonly Readonly<FieldInfo>[]> {
    return this.controller.fields.promise;
  }
  getCompletion(): Promise<QueryCompletion> {
    return this.controller.completion.promise;
  }
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    try {
      while (!this.controller.closed) {
        const rows = await this.read();
        if (!rows.length) break;
        yield* rows;
      }
    } finally {
      await this.close();
    }
  }
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}

type CursorRequest<T> =
  | { type: "read"; maxRows: number; response: ReturnType<typeof deferred<T[]>> }
  | { type: "close"; response: ReturnType<typeof deferred<void>> };

class CursorController<T> {
  readonly fields = deferred<readonly FieldInfo[]>();
  readonly completion = deferred<QueryCompletion>();
  rowsRead = 0;
  closed = false;
  #requests: CursorRequest<T>[] = [];
  #available = deferred<void>();
  #failure?: unknown;

  async read(maxRows: number): Promise<T[]> {
    if (this.#failure) throw this.#failure;
    if (this.closed) return [];
    const response = deferred<T[]>();
    this.#push({ type: "read", maxRows, response });
    return await response.promise;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.#failure) throw this.#failure;
    const response = deferred<void>();
    this.#push({ type: "close", response });
    return await response.promise;
  }
  async next(): Promise<CursorRequest<T>> {
    while (!this.#requests.length) {
      await this.#available.promise;
      this.#available = deferred<void>();
    }
    return this.#requests.shift()!;
  }
  fail(error: unknown): void {
    this.#failure = error;
    this.closed = true;
    this.fields.reject(error);
    this.completion.reject(error);
    for (const request of this.#requests) request.response.reject(error);
    this.#requests.length = 0;
    this.#available.resolve();
  }
  #push(request: CursorRequest<T>): void {
    this.#requests.push(request);
    this.#available.resolve();
  }
}

export class CopyFromHandleImpl implements CopyFromHandle {
  constructor(
    private connection: PgConnectionImpl,
    private ready: Promise<void>,
    private finish: ReturnType<typeof deferred<{ failure?: string }>>,
    readonly complete: Promise<{ rows: number }>,
  ) {}
  #closed = false;
  #writes = Promise.resolve();
  readonly writable = new WritableStream<Uint8Array>({
    write: (chunk) => this.write(chunk),
    close: () => this.closeWrite().then(() => undefined),
    abort: (reason) => this.abort(reason),
  });
  async write(chunk: Uint8Array): Promise<void> {
    if (this.#closed) throw new Error("COPY input is closed");
    await this.ready;
    this.#writes = this.#writes.then(() => this.connection.writeCopyData(chunk));
    await this.#writes;
  }
  async closeWrite(): Promise<{ rows: number }> {
    if (!this.#closed) {
      this.#closed = true;
      await this.#writes;
      this.finish.resolve({});
    }
    return await this.complete;
  }
  async abort(reason?: unknown): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.ready;
    await this.#writes;
    this.finish.resolve({ failure: reason instanceof Error ? reason.message : String(reason ?? "COPY aborted") });
    await this.complete.catch(() => undefined);
  }
}

function statementText(statement: SqlStatement<unknown> | SqlStatements | Uint8Array[]): string {
  const value = typeof statement === "object" && statement !== null && "sqlTemplate" in statement
    ? statement.sqlTemplate
    : typeof statement === "object" && statement !== null && "sqlStatement" in statement
    ? statement.sqlStatement
    : statement;
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  return Array.from(
    value as Iterable<string | Uint8Array>,
    (part) => typeof part === "string" ? part : new TextDecoder().decode(part),
  ).join("");
}

function isParameterized<T>(
  statement: SqlStatement<T>,
): statement is Extract<SqlStatement<T>, { sqlTemplate: unknown }> {
  return typeof statement === "object" && statement !== null && "sqlTemplate" in statement && "args" in statement;
}

function normalizeFormats(
  formats: 0 | 1 | ArrayLike<0 | 1> | (Iterable<0 | 1> & { length: number }),
  length: number,
): PgFormat[] {
  return typeof formats === "number" ? Array(length).fill(formats) : Array.from(formats);
}

function toFields(fields: readonly PgFieldDescription[]): FieldInfo[] {
  return fields.map((field, index) => ({
    index,
    name: field.name,
    typeId: field.dataTypeOid,
    typeSize: field.dataTypeSize,
    typeModifier: field.typeModifier,
  }));
}

function decodeRow(
  values: readonly (Uint8Array | null)[],
  fields: readonly PgFieldDescription[],
  options?: QueryOptions,
) {
  const row: Record<string, unknown> = {};
  const textDecoder = new TextDecoder();
  values.forEach((value, index) => {
    const field = fields[index];
    if (!field) return;
    if (value === null) row[field.name] = null;
    else {
      const decoder = options?.columnDecoders instanceof Map
        ? options.columnDecoders.get(index)
        : typeof options?.columnDecoders === "function"
        ? options.columnDecoders(toFields(fields)[index])
        : options?.typeDecoders?.[field.dataTypeOid] ?? PG_DATA_DECODER_V1[field.dataTypeOid];
      const context = { typeId: field.dataTypeOid, typeSize: field.dataTypeSize, typeModifier: field.typeModifier };
      row[field.name] = decoder
        ? field.format === PgFormat.binary
          ? decoder.binary(value, context)
          : decoder.text(textDecoder.decode(value), context)
        : field.format === PgFormat.binary
        ? value
        : textDecoder.decode(value);
    }
  });
  return row;
}

function parseRowCount(tag: string, fallback: number): number {
  const value = Number(tag.match(/(\d+)$/)?.[1]);
  return Number.isSafeInteger(value) ? value : fallback;
}

function completion(result: MaterializedResult): QueryCompletion {
  return { status: "complete", rowCount: result.rowCount, fields: result.fields, notices: result.notices };
}

function isAsync(message: PgBackendMessage): boolean {
  return message.type === BACKEND_MSG_CODE.notice || message.type === BACKEND_MSG_CODE.notification ||
    message.type === BACKEND_MSG_CODE.parameterStatus;
}

async function collectStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of stream) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
