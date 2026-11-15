import { DataStream } from "@/_utils/DataStream.ts";
import { ReadableBuffer, ReadBuffer } from "../../src/_utils/ReadBuffer.ts";
import { WriteBuffer } from "@/_utils/WriterBuffer.ts";
import { BackendMessageCode, PgTransactionStatus } from "@/protocol/const.ts";

function backendMessage(code: BackendMessageCode, body = new Uint8Array()) {
  const frame = new Uint8Array(5 + body.byteLength);
  frame[0] = code;
  new DataView(frame.buffer).setUint32(1, 4 + body.byteLength);
  frame.set(body, 5);
  return frame;
}

export function encodeParseComplete() {
  return backendMessage(BackendMessageCode.ParseComplete);
}

export function encodeBindComplete() {
  return backendMessage(BackendMessageCode.BindComplete);
}

export function encodeRowDescription() {
  return backendMessage(BackendMessageCode.RowDescription, new Uint8Array(2));
}

export function encodeDataRow() {
  return backendMessage(BackendMessageCode.DataRow, new Uint8Array(2));
}

export function encodeCommandComplete(commandTag: string) {
  return backendMessage(BackendMessageCode.CommandComplete, new TextEncoder().encode(commandTag + "\0"));
}

export function encodeReadyForQuery(status: PgTransactionStatus = PgTransactionStatus.Idle) {
  return backendMessage(BackendMessageCode.ReadyForQuery, new Uint8Array([status]));
}

export class MockDataStream extends WriteBuffer implements DataStream {
  constructor(options: { onWriteData?: (data: Uint8Array) => number; onServerEnd?: () => void } = {}) {
    super(async (data) => {
      if (this.#clientDestroyed) throw this.#clientDestroyed;
      if (this.#clientClosed) throw new Error("MockDataStream is closed");
      return this.onWriteData(data);
    }, 4 * 1024);
    this.onWriteData = options.onWriteData ?? ((data) => data.byteLength);
    this.onServerEnd = options.onServerEnd ?? (() => {});
    this.#readBuffer = new ReadBuffer(new Uint8Array(4 * 1024));
  }
  private onWriteData: (data: Uint8Array) => number;
  private onServerEnd: () => void;

  readonly #readBuffer: ReadBuffer;
  #clientOnData?: (buffer: ReadableBuffer) => boolean | undefined | void;
  #clientOnEnd?: () => void;
  startReadLoop(onData: (buffer: ReadableBuffer) => boolean | undefined | void, onEnd: () => void): void {
    this.#clientOnData = onData;
    this.#clientOnEnd = onEnd;
    this.#checkClientOnData();
  }
  #checkClientOnData() {
    if (!this.#clientOnData) return;

    const onData = this.#clientOnData;
    const reader = this.#readBuffer;
    const buffer = reader.buffer;
    for (let chunk of this.#serverData) {
      let freeSpace = buffer.byteLength - reader.readableEnd;
      while (chunk.byteLength > freeSpace) {
        buffer.set(chunk.subarray(0, freeSpace), reader.readableEnd);
        reader.readableEnd = buffer.byteLength;
        chunk = chunk.subarray(freeSpace);

        onData(reader);
        reader.compact();

        freeSpace = buffer.byteLength - reader.readableEnd;
      }
      reader.buffer.set(chunk, reader.readableEnd);
      reader.readableEnd += chunk.byteLength;
    }
    this.#serverData = [];
    if (reader.readableLength) {
      onData(reader);
      reader.compact();
    }
    if (this.#serverClosed) {
      this.#clientOnEnd?.();
    }
  }

  listenOnError(onError: undefined | ((error: Error) => void)): void {
    this.#onError = onError ?? undefined;
  }
  #clientClosed: boolean = false;
  async closeWrite(): Promise<void> {
    this.#clientClosed = true;
    this.onServerEnd();
  }

  #clientDestroyed?: Error;
  destroy(): void {
    this.#clientDestroyed = new Error("MockDataStream destroyed");
  }
  mockStreamError(error: Error): void {
    this.#clientDestroyed = error;
    this.#onError?.(error);
  }

  #onError?: (error: Error) => void;

  #serverData: Uint8Array[] = [];
  serverPushData(data: Uint8Array) {
    this.#serverData.push(data);
    this.#checkClientOnData();
  }
  #serverClosed: boolean = false;
  serverCloseWrite() {
    this.#serverClosed = true;
    this.#checkClientOnData();
  }
}
