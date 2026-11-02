import type { TransactionMode } from "@/interface/Query.ts";
import { QueryResultParser } from "./QueryResultParser.ts";

export type PgMessageTask =
  | BeginTransactionTask
  | QueryResultParser
  | CloseTask
  | EmptyTask;

export interface BeginTransactionTask {
  taskType: QueryAction.Begin;
  mode?: TransactionMode;
}

type EmptyTask = {
  taskType: QueryAction.Commit | QueryAction.Rollback | QueryAction.Sync;
};
type CloseTask = {
  taskType: QueryAction.Close;
  resolve: () => void;
  reject: (reason: unknown) => void;
};

type EmptyReceiver = {
  type: ReceiverType.StartTransaction | ReceiverType.EndTransaction | ReceiverType.Sync;
};

export type ResultReceiver = QueryResultParser | EmptyReceiver;
export interface ParseMessageEncoder {
  statement?: string;
  done: boolean;
  /** sql + parameter oids */
  byteLength: number;
  encodeInto(buffer: Uint8Array, offset: number): number;
}
export interface BindMessageEncoder {
  portal?: string;
  done: boolean;
  /** parameters + formats */
  byteLength: number;
  encodeInto(buffer: Uint8Array, offset: number): number;
}

export interface QueryMessageEncoder {
  done: boolean;
  encodeInto(buffer: Uint8Array, offset: number): number;
}
export enum QueryAction {
  Close,
  ExtendedQuery,
  SimpleQuery,

  Begin,
  Sync,
  Commit = "COMMIT",
  Rollback = "ROLLBACK",
}

export enum ReceiverType {
  ExtendedQuery,
  SimpleQuery,
  Sync,
  StartTransaction,
  EndTransaction,
}
