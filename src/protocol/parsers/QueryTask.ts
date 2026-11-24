import { DecodeRowDescriptionResult } from "@/protocol.ts";

export type EmptyReceiver = {
  taskType: ReceiverType.StartTransaction | ReceiverType.EndTransaction | ReceiverType.Sync;
  resolve?: () => void;
  reject?: (reason: unknown) => void;
};
export type CloseReceiver = {
  taskType: ReceiverType.ClosePortal;
  resolve: () => void;
  reject: (reason: unknown) => void;
};
export type QueryParserResult<T = unknown> = {
  readonly rows: T[];
  readonly notices: string[];
  readonly rowCount: number | null;
  readonly fields: Readonly<DecodeRowDescriptionResult>[];
  readonly completed: boolean;
};

export enum ReceiverType {
  RowDescription,
  ClosePortal,
  ExtendedQuery,
  SimpleQuery,
  Sync,
  StartTransaction,
  EndTransaction,
}
