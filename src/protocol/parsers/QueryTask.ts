import type { TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { QueryResultParser } from "./QueryResultParser.ts";

export type QueryTask =
  | ExtendedQueryTask
  | SimpleQueryTask;

interface TaskBase<T> {
  resolve: (result: T) => void;
  reject: (reason: unknown) => void;
}
export interface ConnectTask extends TaskBase<{ resolve: () => void; reject: (reason: unknown) => void }> {}

export interface ExtendedQueryTask extends TaskBase<QueryResultParser> {
  type: QueryAction.ExtendedQuery;
  statement: TypedSqlStatementEncoder;
  sync?: boolean;
}

export interface SimpleQueryTask extends TaskBase<QueryResultParser[]> {
  type: QueryAction.SimpleQuery;
  statement: TypedSqlStatementEncoder;
}

export type ResultReceiver = QueryResultParser | typeof SYNC;

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
export const SYNC = Symbol("SYNC");
export enum QueryAction {
  ExtendedQuery,
  SimpleQuery,
}
