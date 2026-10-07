import type { TransactionMode, TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { QueryResultParser, SampleQueryResultParser } from "./QueryResultParser.ts";

export type QueryTask =
  | BeginTransactionTask
  | ExtendedQueryTask
  | SimpleQueryTask
  | EmptyTask;

export interface ExtendedQueryTask {
  type: QueryAction.ExtendedQuery;
  statement: TypedSqlStatementEncoder;
  resolve: (result: QueryResultParser) => void;
  reject: (reason: unknown) => void;
}

export interface SimpleQueryTask {
  type: QueryAction.SimpleQuery;
  statement: TypedSqlStatementEncoder;
  resolve: (result: SampleQueryResultParser) => void;
  reject: (reason: unknown) => void;
}

export interface BeginTransactionTask {
  type: QueryAction.Begin;
  mode?: TransactionMode;
}

type EmptyTask = {
  type: QueryAction.Commit | QueryAction.Rollback;
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
