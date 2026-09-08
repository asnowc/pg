import type { Query } from "@/query.ts";
import type { PgConnection } from "./PgConnection.ts";

/** @public */
export interface PgPool extends Query, AsyncDisposable {
  connect(): Promise<PgPoolConnection>;

  get idleCount(): number;
  get totalCount(): number;

  [Symbol.asyncDispose](): Promise<void>;
}

/** @public */
export interface PgPoolConnection extends Query, AsyncDisposable {
  get released(): boolean;
  release(): void;
  [Symbol.dispose](): void;
}

export interface CreatePoolOptions {
  // Define the options for creating a pool here
  create?: () => Promise<PgConnection>;
}

/** @public */
export function createPgPool(options?: CreatePoolOptions): PgPool {
  // Implementation here
  throw new Error("Not implemented");
}
