import type { Query } from "@/query.ts";

export interface PgPool extends Query, AsyncDisposable {
  connect(): Promise<PgPoolConnection>;

  get idleCount(): number;
  get totalCount(): number;

  [Symbol.asyncDispose](): Promise<void>;
}

export interface PgPoolConnection extends Query, AsyncDisposable {
  get released(): boolean;
  release(): void;
  [Symbol.dispose](): void;
}
