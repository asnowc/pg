import type { AsyncReader, ByteStream } from "@/interface/ByteStream.ts";
import { readInto, readLength, writeInto } from "@/_utils/ByteStream.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import {
  BackendMessageCode,
  decodeNotice,
  decodeNotification,
  decodeParameterStatus,
  encodeTerminateMessage,
  PgTransactionStatus,
} from "@/protocol.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import type { ReaderWriter, BufferWriter } from "@/_utils/DataBuffer.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;
const SASSING_BUFFER_WORK_SIZE = 8 * 1024;

export interface PgController {
  readonly reader: ReaderWriter;
  readonly writer: BufferWriter;
}

export class PgSession {
  constructor(stream: ByteStream, config: { maxMessageSize?: number; bufferWorkSize?: number }) {
    this.#stream = stream;
    this.maxMessageSize = config.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;
    this.#buffer = new Uint8Array(config.bufferWorkSize ?? SASSING_BUFFER_WORK_SIZE);
    this.#bufferView = new DataView(this.#buffer.buffer);
    this.finish = this.start().then(() => {
      if (!this.isCloseCalled) {
        this.isCloseCalled = true;
        return this.#stream.close();
      }
    }).catch((error) => {
      this.#subscriber.reject(error);
    });
  }
  maxMessageSize: number;

  processId: number | null = null;
  secretKey: number | null = null;
  parameters: Record<string, string> = {};

  readonly #stream: ByteStream;
  readonly finish: Promise<void>;

  private async start() {
    let message = await this.#read();
    while (message) {
      await this.#onMessage(this.#stream, message.type, message.length);
      message = await this.#read();
    }
  }
  readonly #buffer: Uint8Array;
  readonly #bufferView: DataView;
  /** 前一次读取返回结果前不得再次调用；*/
  async #read() {
    const stream = this.#stream;
    await readInto(stream, this.#buffer, 0, 5); // 5 bytes
    const type = this.#buffer[0];
    const bodyLength = this.#bufferView.getInt32(1);
    checkMessageLength(bodyLength, this.maxMessageSize);
    return { type, length: bodyLength - 4 };
  }

  transactionStatus: PgTransactionStatus = PgTransactionStatus.Idle;
  async #onMessage(reader: AsyncReader, type: number, bodyLength: number) {
    switch (type) {
      case BackendMessageCode.ParameterStatus: {
        const body = await readLength(reader, bodyLength);
        const { name, value } = decodeParameterStatus(body);
        this.parameters[name] = value;
        break;
      }
      case BackendMessageCode.NotificationResponse: {
        const body = await readLength(reader, bodyLength);
        const message = decodeNotification(body);
        const data = {
          type: AsyncMessageType.Notification,
          processId: message.processId,
          channel: message.channel,
          payload: message.payload,
        };
        break;
      }
      case BackendMessageCode.NoticeResponse: {
        const body = await readLength(reader, bodyLength);
        const message = decodeNotice(body);
        const data = { type: AsyncMessageType.Notice, fields: message.fields, info: message.info };
        break;
      }
      default: {
        return this.#subscriber.onMessage(reader, type, bodyLength);
      }
    }
  }
  removeSubscriber() {
    this.#subscriber.resolve();
    this.#subscriber = {
      resolve: () => {},
      reject: () => {},
      onMessage: () => {},
    };
  }
  #subscriber: MessageListeners = {
    resolve: () => {},
    reject: () => {},
    onMessage: () => {},
  };

  subscribe(listeners: Pick<MessageListeners, "onMessage">): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#subscriber = {
        onMessage: listeners.onMessage,
        reject,
        resolve,
      };
    });
  }

  async write(data: Uint8Array): Promise<void> {
    await writeInto(this.#stream, data);
  }

  /** 如果为 true , 则不可在进行写入操作 */
  isCloseCalled: boolean = false;
  async close(): Promise<void> {
    if (this.isCloseCalled) return this.finish;
    this.isCloseCalled = true;
    const stream = this.#stream;
    try {
      await writeInto(stream, encodeTerminateMessage());
      await stream.closeWrite();
    } catch {
      stream.close();
    }
    return this.finish;
  }
  destroy(): void {
    this.#stream.close();
    this.isCloseCalled = true;
  }
}
type MessageListeners = {
  resolve: () => void;
  reject: (reason?: unknown) => void;
  onMessage: Listener;
};
type Listener = (reader: AsyncReader, type: number, bodyLength: number) => void | Promise<unknown>;
function checkMessageLength(length: number, maxLength: number) {
  if (length < 4) {
    throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`);
  }
  if (length > maxLength) {
    throw new Error(`PostgreSQL message length exceeds the maximum allowed size: ${length}`);
  }
}
