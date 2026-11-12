import { vi } from "vitest";
import { type CreatePoolOptions, type PgConnection, PgPool } from "@asla/pg";
import { createPgConnection } from "@/class/PgConnection.ts";
import { EventEmitter } from "@/_utils/EventEmitter.ts";
import { PgSession } from "@/protocol.ts";

type MockResult = { rows: unknown[]; notices: string[]; rowCount: number };

export class MockSession extends EventEmitter {
  meta = { date: 0 };
  constructor(readonly processId: number) {
    super();
  }
  pendingQueyNumber = 0;
  closed = false;
  queries: PromiseWithResolvers<MockResult>[] = [];
  queryWriter = {
    extendedQuery: vi.fn(() => {
      const query = Promise.withResolvers<MockResult>();
      this.queries.push(query);
      this.pendingQueyNumber++;
      return query.promise;
    }),
    sync: vi.fn(),
  };
  close = vi.fn(async () => {
    this.closed = true;
    if (this.pendingQueyNumber === 0) this.emit("close", undefined);
  });
  destroy = vi.fn((error?: Error) => {
    this.closed = true;
    for (const query of this.queries) query.reject(error ?? new Error("Session destroyed"));
    this.queries = [];
    this.pendingQueyNumber = 0;
    this.emit("close", undefined);
  });

  completeQuery(error?: Error) {
    const query = this.queries.shift();
    if (!query) throw new Error("No pending query");
    if (error) query.reject(error);
    else query.resolve({ rows: [], notices: [], rowCount: 0 });
  }

  readyQuery() {
    if (this.pendingQueyNumber === 0) throw new Error("No pending query");
    this.pendingQueyNumber--;
    if (this.pendingQueyNumber === 0) {
      this.emit("idle", undefined);
      if (this.closed) this.emit("close", undefined);
    }
  }

  finishQuery(error?: Error) {
    this.completeQuery(error);
    this.readyQuery();
  }
}

export function createMockConnection(sessions: MockSession[]): PgConnection {
  const session = new MockSession(sessions.length + 1);
  sessions.push(session);
  return createPgConnection(session as unknown as PgSession);
}

export function createHarness(options: Omit<CreatePoolOptions, "create"> = {}) {
  const sessions: MockSession[] = [];
  const create = vi.fn<CreatePoolOptions["create"]>(async () => createMockConnection(sessions));
  const pool = new PgPool({ ...options, create });
  return { pool, sessions, create };
}
