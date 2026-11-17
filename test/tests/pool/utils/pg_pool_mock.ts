import { expect, onTestFinished, vi } from "vitest";
import { type CreatePoolOptions, PgPool } from "@asla/pg";
import { createPgConnection } from "@/class/PgConnection.ts";
import { PgSession } from "@/protocol.ts";
import {
  encodeBindComplete,
  encodeCommandComplete,
  encodeParseComplete,
  encodeReadyForQuery,
  encodeRowDescription,
  MockDataStream,
} from "@test/utils/mock_data_stream.ts";

export function createMockConnection(id: number) {
  const onServerEnd = vi.fn(() => stream.serverCloseWrite());
  const stream = new MockDataStream({ onServerEnd });
  vi.spyOn(stream, "closeWrite");
  const destroy = stream.destroy.bind(stream);
  vi.spyOn(stream, "destroy").mockImplementation(() => {
    destroy();
    stream.serverCloseWrite();
  });
  const session = new PgSession(stream, {
    authResult: {
      backendKey: { processId: id, secretKey: id },
      newestMinorVersion: 0,
      unsupportedOptions: [],
    },
  });
  const conn = createPgConnection(session);
  const sessionFinished = new Promise<void>((resolve, reject) => {
    session.on("close", resolve);
    session.on("error", reject);
  });
  const finished = Promise.allSettled([sessionFinished]).then(([result]) => result);

  function completeQuery() {
    stream.serverPushData(encodeParseComplete());
    stream.serverPushData(encodeBindComplete());
    stream.serverPushData(encodeRowDescription());
    stream.serverPushData(encodeCommandComplete("SELECT 0"));
  }

  function readyQuery() {
    stream.serverPushData(encodeReadyForQuery());
  }

  function finishQuery() {
    completeQuery();
    readyQuery();
  }

  return { session, stream, conn, finished, onServerEnd, completeQuery, readyQuery, finishQuery };
}

export function createHarness(options: Omit<CreatePoolOptions, "create"> = {}) {
  const connections: ReturnType<typeof createMockConnection>[] = [];
  const create = vi.fn<CreatePoolOptions["create"]>(async () => {
    const connection = createMockConnection(connections.length + 1);
    connections.push(connection);
    return connection.conn;
  });
  const pool = new PgPool({ ...options, create });
  onTestFinished(() => {
    pool.destroy();
    expect(pool.totalCount).toBe(0);
    expect(pool.queueLength).toBe(0);
  });
  return { pool, connections, create };
}
