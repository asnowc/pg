import { QueryResultQueue } from "./QueryQueue.ts";
import { AuthenticationResult } from "./auth.ts";
import { encodeTerminateMessage } from "./encode.ts";
import { decodeNotice, decodeNotification, decodeParameterStatus } from "./decode.ts";
import { BackendMessageCode } from "./const.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import { MessageParsers } from "./parsers/MessageParser.ts";
import { ConnectionStream } from "@/_utils/ConnectionStream.ts";
import { StreamWriter } from "@/_utils/StreamWriter.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

export class PgSession {
  constructor(
    private readonly stream: ConnectionStream,
    private readonly config: { maxMessageSize?: number; authResult: AuthenticationResult },
  ) {
    const { authResult, maxMessageSize = DEFAULT_MAX_MESSAGE_SIZE } = this.config;
    this.stream = stream;
    this.processId = authResult.backendKey?.processId ?? null;
    this.secretKey = authResult.backendKey?.secretKey ?? null;

    const parser = new MessageParsers(maxMessageSize);
    parser.set(BackendMessageCode.ParameterStatus, (data) => {
      const { name, value } = decodeParameterStatus(data);
      this.parameters[name] = value;
    });
    parser.set(BackendMessageCode.NotificationResponse, (data) => {
      const message = decodeNotification(data);
      const asyncData = {
        type: AsyncMessageType.Notification,
        processId: message.processId,
        channel: message.channel,
        payload: message.payload,
      };
    });
    parser.set(BackendMessageCode.NoticeResponse, (data) => {
      const message = decodeNotice(data);
      const asyncData = { type: AsyncMessageType.Notice, fields: message.fields, info: message.info };
    });
    this.queryQueue = new QueryResultQueue(parser);

    stream.startReadLoop(() => parser.next(this.stream), () => {
      if (!this.isCloseCalled) this.destroy();
    });
    stream.listenOnError((err) => {
    });
  }
  get writer(): StreamWriter {
    return this.stream;
  }

  readonly processId: number | null;
  readonly secretKey: number | null;
  readonly parameters: Record<string, string> = {};
  readonly queryQueue: QueryResultQueue;

  /** 如果为 true , 则不可在进行写入操作 */
  private get isCloseCalled() {
    return !!this.closePromise;
  }
  async close(): Promise<void> {
    if (this.isCloseCalled) {
      await this.closePromise;
      return;
    }
    const promise = this.#close().then(
      () => this.closePromise = undefined,
      () => this.closePromise = undefined,
    );
    this.closePromise = promise;
    return this.closePromise;
  }
  private closePromise?: Promise<void> | boolean;
  async #close() {
    if (this.isCloseCalled) return this.closePromise;
    this.closePromise = true;
    this.stream.pushData(encodeTerminateMessage());
    return this.stream.closeWrite();
  }
  destroy(): void {
    this.stream.destroy();
    this.closePromise = true;
  }
}
