import { QueryQueue } from "@/protocol/QueryQueue.ts";
import { AuthenticationResult } from "./auth.ts";
import { encodeTerminateMessage } from "./encode.ts";
import { decodeNotice, decodeNotification, decodeParameterStatus } from "./decode.ts";
import { BackendMessageCode, PgTransactionStatus } from "./const.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import { checkMessageLength, MessageFullParser } from "./MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { StreamParser, StreamReader } from "@/_utils/StreamReader.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

export class PgSession {
  constructor(
    private readonly stream: ConnectionStream,
    private readonly config: { maxMessageSize?: number; authResult: AuthenticationResult },
  ) {
    const { authResult, maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE } = this.config;
    this.stream = stream;
    this.maxMessageSize = maxMessageSize;
    this.processId = authResult.backendKey?.processId ?? null;
    this.secretKey = authResult.backendKey?.secretKey ?? null;

    stream.startReadLoop(this.#onData, () => {
      if (!this.isCloseCalled) this.destroy();
    });
  }
  readonly maxMessageSize: number;

  readonly processId: number | null;
  readonly secretKey: number | null;
  readonly parameters: Record<string, string> = {};

  transactionStatus: PgTransactionStatus = PgTransactionStatus.Idle;

  #current?: { readonly type: number; bodyLength?: number; parser?: StreamParser<unknown> };

  #onData = (): void => {
    const reader = this.stream;
    let current = this.#current;
    while (reader.readableLength) {
      if (!current) {
        current = { type: reader.readUInt8() };
        this.#current = current;
      }
      if (!current.bodyLength) {
        if (reader.readableLength < 4) return;
        const messageLength = reader.readInt32BE();
        checkMessageLength(messageLength, this.maxMessageSize);
        current.bodyLength = messageLength - 4;
      }
      if (!current.parser) current.parser = this.#onMessage(reader, current.type, current.bodyLength!);
      const result = current.parser.next(reader);
      if (!result) return;
      this.#current = undefined;
    }
  };
  #onMessage(reader: StreamReader, type: number, bodyLength: number): StreamParser<unknown> {
    switch (type) {
      case BackendMessageCode.ParameterStatus: {
        return new MessageFullParser(bodyLength, (data) => {
          const { name, value } = decodeParameterStatus(data);
          this.parameters[name] = value;
        });
      }
      case BackendMessageCode.NotificationResponse: {
        return new MessageFullParser(bodyLength, (bin) => {
          const message = decodeNotification(bin);
          const data = {
            type: AsyncMessageType.Notification,
            processId: message.processId,
            channel: message.channel,
            payload: message.payload,
          };
        });
      }
      case BackendMessageCode.NoticeResponse: {
        return new MessageFullParser(bodyLength, (done) => {
          const message = decodeNotice(done as Uint8Array);
          const data = { type: AsyncMessageType.Notice, fields: message.fields, info: message.info };
        });
      }
      default:
        return this.queryQueue.onMessage(reader, type, bodyLength);
    }
  }
  readonly queryQueue = new QueryQueue();
  /** 如果为 true , 则不可在进行写入操作 */
  private get isCloseCalled() {
    return !!this.#closePromise;
  }
  async close(): Promise<void> {
    if (this.isCloseCalled) {
      await this.#closePromise;
      return;
    }
    const promise = this.#close().then(
      () => this.#closePromise = undefined,
      () => this.#closePromise = undefined,
    );
    this.#closePromise = promise;
    return this.#closePromise;
  }
  #closePromise?: Promise<void> | boolean;
  async #close() {
    if (this.isCloseCalled) return this.#closePromise;
    this.#closePromise = true;
    this.stream.pushData(encodeTerminateMessage());
    return this.stream.closeWrite();
  }
  destroy(): void {
    this.stream.destroy();
    this.#closePromise = true;
  }
}
