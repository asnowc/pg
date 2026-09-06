import { BACKEND_MSG_CODE, decodeBackendMessage, encodeFrontendMessage, FRONTEND_MSG_CODE } from "./pg_message.ts";
import type { PgAsyncMessage, PgCopyResponse, PgTransactionStatus } from "./pg_message.ts";
import type { PgMessageReader } from "./PgMessageReader.ts";

/**
 * 写入一段 COPY 数据；分片不要求与行边界一致。
 * @public
 */
export async function copyData(stream: PgMessageReader, data: Uint8Array): Promise<void> {
  await writeMessage(stream, { type: FRONTEND_MSG_CODE.copyData, data });
}

/**
 * 通知服务端 COPY FROM STDIN 输入完成。
 * @public
 */
export async function copyDone(stream: PgMessageReader): Promise<void> {
  await writeMessage(stream, { type: FRONTEND_MSG_CODE.copyDone });
}

/**
 * 使 COPY FROM STDIN 失败并向服务端报告原因。
 * @public
 */
export async function copyFail(stream: PgMessageReader, reason: string): Promise<void> {
  await writeMessage(stream, { type: FRONTEND_MSG_CODE.copyFail, reason });
}

/** @public */
export interface PgCopyOptions {
  onAsyncMessage?: (message: PgAsyncMessage) => void | Promise<void>;
}

/** @public */
export type PgCopyOutEvent =
  | { type: "start"; response: PgCopyResponse }
  | { type: "data"; data: Uint8Array }
  | { type: "done" }
  | { type: "commandComplete"; tag: string }
  | { type: "readyForQuery"; status: PgTransactionStatus };

/**
 * 读取 COPY TO STDOUT/COPY BOTH 数据，异步消息不会终止迭代。
 * @public
 */
export async function* readCopyOut(stream: PgMessageReader, options: PgCopyOptions): AsyncGenerator<PgCopyOutEvent> {
  while (true) {
    const pending = await stream.read();
    if (!pending) throw new Error("PostgreSQL closed the connection during COPY OUT");
    const message = decodeBackendMessage(pending.type, await pending.readBody());
    switch (message.type) {
      case BACKEND_MSG_CODE.copyOutResponse:
      case BACKEND_MSG_CODE.copyBothResponse:
        yield { type: "start", response: message };
        break;
      case BACKEND_MSG_CODE.copyData:
        yield { type: "data", data: message.data };
        break;
      case BACKEND_MSG_CODE.copyDone:
        yield { type: "done" };
        break;
      case BACKEND_MSG_CODE.commandComplete:
        yield { type: "commandComplete", tag: message.tag };
        break;
      case BACKEND_MSG_CODE.readyForQuery:
        yield { type: "readyForQuery", status: message.status };
        return;
      case BACKEND_MSG_CODE.notice:
      case BACKEND_MSG_CODE.notification:
      case BACKEND_MSG_CODE.parameterStatus:
        await options.onAsyncMessage?.(message);
        break;
      case BACKEND_MSG_CODE.error:
        throw new Error(message.fields.message, { cause: message });
    }
  }
}

async function writeMessage(
  stream: PgMessageReader,
  message: Parameters<typeof encodeFrontendMessage>[0],
): Promise<void> {
  for (const part of encodeFrontendMessage(message)) await stream.write(part);
}
