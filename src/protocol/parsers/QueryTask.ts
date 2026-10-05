import type { TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { QueryResultParser } from "./QueryResultParser.ts";

export type QueryTask =
  | BeginTransactionTask
  | EndTransactionTask
  | ExtendedQueryTask
  | SimpleQueryTask;

export interface ExtendedQueryTask {
  type: QueryAction.ExtendedQuery;
  statement: TypedSqlStatementEncoder;
  sync?: boolean;
  resolve: (result: QueryResultParser) => void;
  reject: (reason: unknown) => void;
}

export interface SimpleQueryTask {
  type: QueryAction.SimpleQuery;
  statement: TypedSqlStatementEncoder;
  resolve: (result: QueryResultParser[]) => void;
  reject: (reason: unknown) => void;
}

export interface BeginTransactionTask {
  type: QueryAction.Begin;
}
export interface EndTransactionTask {
  type: QueryAction.Commit | QueryAction.Rollback;
}

export type ResultReceiver =
  | QueryResultParser
  | TaskResultType.StartTransaction
  | TaskResultType.EndTransaction
  | TaskResultType.Sync;

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
  ExtendedQuery,
  SimpleQuery,

  Begin,
  Commit,
  Rollback,
}

export enum TaskResultType {
  Sync,
  StartTransaction,
  EndTransaction,
}
