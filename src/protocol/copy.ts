import type { PgAsyncMessage, PgCopyResponse, PgTransactionStatus } from "@/driver/protocol/pg_message.ts";
import type { PgMessageReader } from "./PgMessageReader.ts";

/** 写入一段 COPY 数据；分片不要求与行边界一致。 */
export declare function copyData(stream: PgMessageReader, data: Uint8Array): Promise<void>;

/** 通知服务端 COPY FROM STDIN 输入完成。 */
export declare function copyDone(stream: PgMessageReader): Promise<void>;

/** 使 COPY FROM STDIN 失败并向服务端报告原因。 */
export declare function copyFail(stream: PgMessageReader, reason: string): Promise<void>;

export interface PgCopyOptions {
  onAsyncMessage?: (message: PgAsyncMessage) => void | Promise<void>;
}

export type PgCopyOutEvent =
  | { type: "start"; response: PgCopyResponse }
  | { type: "data"; data: Uint8Array }
  | { type: "done" }
  | { type: "commandComplete"; tag: string }
  | { type: "readyForQuery"; status: PgTransactionStatus };

/** 读取 COPY TO STDOUT/COPY BOTH 数据，异步消息不会终止迭代。 */
export declare function readCopyOut(stream: PgMessageReader, options: PgCopyOptions): AsyncGenerator<PgCopyOutEvent>;
