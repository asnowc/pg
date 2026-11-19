import { ReadableBuffer } from "@/_utils/ReadBuffer.ts";
import { DecodeRowDescriptionResult } from "@/protocol.ts";

type EmptyReceiver = {
  taskType: ReceiverType.StartTransaction | ReceiverType.EndTransaction | ReceiverType.Sync;
};
export interface QueryResultParser<T = undefined> {
  resolve(result: QueryResultParser<T>): void;
  reject(error: unknown): void;
  readonly taskType: ReceiverType.ExtendedQuery | ReceiverType.SimpleQuery;
  dataRow(reader: ReadableBuffer, remainingByteLength: number): void;
  rowDescription(reader: ReadableBuffer, remainingByteLength: number): void;
  commandComplete(body: Uint8Array): void;
  readonly rows: T[];
  readonly notices: string[];
  readonly rowCount?: number;
  readonly fields?: DecodeRowDescriptionResult[];
}

export type ResultReceiver = QueryResultParser | EmptyReceiver;

export enum ReceiverType {
  ExtendedQuery,
  SimpleQuery,
  Sync,
  StartTransaction,
  EndTransaction,
}
