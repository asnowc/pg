import { TypedSqlStatementEncoder } from "@/interface/Query.ts";
import { QueryResultParser } from "./QueryResultParser.ts";

export type MessageRequest =
  | ExtendedQueryRequest
  | SimpleQueryRequest
  | StartTransactionRequest
  | EndTransactionRequest;

export interface ExtendedQueryRequest {
  type: QueryAction.ExtendedQuery;
  statement: TypedSqlStatementEncoder;
  resolve: (resolver: QueryResultParser) => void;
  reject: (reason: unknown) => void;
}

export interface SimpleQueryRequest {
  type: QueryAction.SimpleQuery;
  statement: TypedSqlStatementEncoder;
  resolve: (resolver: QueryResultParser) => void;
  reject: (reason: unknown) => void;
}

export interface StartTransactionRequest {
  type: QueryAction.StartTransaction;
  mode: TransactionMode;
}
export interface EndTransactionRequest {
  type: QueryAction.EndTransaction;
  mode: "ROLLBACK" | "COMMIT";
}
export interface RollbackSavePoint {
  type: QueryAction.RollbackSavePoint;
  savePoint: string;
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
  StartTransaction,
  EndTransaction,
  RollbackSavePoint,
}
export enum TransactionMode {
}
