export type EmptyReceiver = {
  taskType: ReceiverType.StartTransaction | ReceiverType.EndTransaction | ReceiverType.Sync;
  resolve?: () => void;
  reject?: (reason: unknown) => void;
};
export type CloseReceiver = {
  taskType: ReceiverType.ClosePortal | ReceiverType.CloseStatement;
  resolve?: () => void;
  reject?: (reason: unknown) => void;
};

export enum ReceiverType {
  RowDescription,
  ClosePortal,
  CloseStatement,
  ExtendedQuery,
  SimpleQuery,
  Sync,
  StartTransaction,
  EndTransaction,
}
