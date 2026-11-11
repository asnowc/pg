import { QueryResultParser } from "./QueryResultParser.ts";

type EmptyReceiver = {
  taskType: ReceiverType.StartTransaction | ReceiverType.EndTransaction | ReceiverType.Sync;
};

export type ResultReceiver = QueryResultParser | EmptyReceiver;

export enum ReceiverType {
  ExtendedQuery,
  SimpleQuery,
  Sync,
  StartTransaction,
  EndTransaction,
}
