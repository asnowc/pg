import type { AsyncReader } from "@/interface/ByteStream.ts";
import { readInto, readLength, writeInto } from "@/_utils/ByteStream.ts";
import { PgProtocolError } from "@/_utils/error.ts";
import {
  AuthenticationResult,
  BackendMessageCode,
  decodeNotice,
  decodeNotification,
  decodeParameterStatus,
  encodeTerminateMessage,
  PgTransactionStatus,
} from "@/protocol.ts";
import { AsyncMessageType } from "@/interface/protocol.ts";
import type { BufferReader, ByteBuffer } from "@/_utils/DataBuffer.ts";

const DEFAULT_MAX_MESSAGE_SIZE = 16 * 1024 * 1024;

export class PgSession {
  constructor(
    private readonly byteBuffer: ByteBuffer,
    config: { maxMessageSize?: number; authResult: AuthenticationResult },
  ) {
    this.byteBuffer = byteBuffer;
    this.maxMessageSize = config.maxMessageSize ?? DEFAULT_MAX_MESSAGE_SIZE;

    byteBuffer.onEnd = () => {
      if (!this.isCloseCalled) {
        this.isCloseCalled = true;
        return this.byteBuffer.destroy();
      }
    };
    byteBuffer.startRead(this.next.bind(this));
  }
  maxMessageSize: number;

  processId: number | null = null;
  secretKey: number | null = null;
  parameters: Record<string, string> = {};

  private currentMessageType?: number;
  private next(): boolean {
    const reader = this.byteBuffer;
    this.currentMessageType ??= reader.readUInt8();
    this.#onMessage(reader, this.currentMessageType);
    return true;
  }

  /** 前一次读取返回结果前不得再次调用；*/
  async #read() {
    const stream = this.byteBuffer;
    await readInto(stream, this.#buffer, 0, 5); // 5 bytes
    const type = this.#buffer[0];
    const bodyLength = this.#bufferView.getInt32(1);
    checkMessageLength(bodyLength, this.maxMessageSize);
    return { type, length: bodyLength - 4 };
  }

  transactionStatus: PgTransactionStatus = PgTransactionStatus.Idle;
  #onMessage(reader: BufferReader, type: number) {
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

  /** 如果为 true , 则不可在进行写入操作 */
  isCloseCalled: boolean = false;
  async close(): Promise<void> {
    if (this.isCloseCalled) return this.finish;
    this.isCloseCalled = true;
    const stream = this.byteBuffer;
    try {
      await writeInto(stream, encodeTerminateMessage());
      await stream.closeWrite();
    } catch {
      stream.close();
    }
    return this.finish;
  }
  destroy(): void {
    this.byteBuffer.destroy();
    this.isCloseCalled = true;
  }
}

function checkMessageLength(length: number, maxLength: number) {
  if (length < 4) {
    throw new PgProtocolError(`Invalid PostgreSQL message length: ${length}`);
  }
  if (length > maxLength) {
    throw new Error(`PostgreSQL message length exceeds the maximum allowed size: ${length}`);
  }
}
