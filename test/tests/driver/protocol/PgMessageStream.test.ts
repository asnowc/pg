import { describe, expect, it, vi } from "vitest";
import type { ByteStream } from "@/driver/protocol/ByteStream.ts";
import { BACKEND_MSG_CODE, FRONTEND_MSG_CODE } from "@/driver/protocol/pg_message/const.ts";
import { PgMessageReader } from "@/driver/protocol/pg_message.ts";
import { eofReads, frame, readMethods } from "./PgMessageStream.test-helpers.ts";

describe("PgMessageStream", () => {
  it("delegates concurrent part writes to the byte stream", async () => {
    let active = 0;
    let maxActive = 0;
    const stream: ByteStream = {
      ...eofReads,
      async write(buffer) {
        active++;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active--;
        return buffer.byteLength;
      },
      closeWrite: () => Promise.resolve(),
      close() {},
    };
    const messageStream = new PgMessageReader(stream);
    await Promise.all([
      messageStream.write({ type: FRONTEND_MSG_CODE.query, sql: "select 1" }),
      messageStream.write({ type: FRONTEND_MSG_CODE.query, sql: "select 2" }),
    ]);
    expect(maxActive).toBe(6);
  });

  it("rejects concurrent reads", async () => {
    const input = frame(BACKEND_MSG_CODE.readyForQuery, Uint8Array.of(0x49));
    const firstReadStarted = Promise.withResolvers<void>();
    const continueFirstRead = Promise.withResolvers<void>();
    let reading = false;
    let firstCall = true;
    let offset = 0;
    const stream: ByteStream = {
      ...readMethods(async (buffer) => {
        if (buffer.byteLength > input.byteLength - offset) throw new Error("Unexpected EOF");
        if (reading) throw new Error("concurrent ByteStream.read");
        reading = true;
        if (firstCall) {
          firstCall = false;
          firstReadStarted.resolve();
          await continueFirstRead.promise;
        }
        buffer.set(input.subarray(offset, offset + buffer.byteLength));
        offset += buffer.byteLength;
        reading = false;
      }),
      write(buffer) {
        return Promise.resolve(buffer.byteLength);
      },
      closeWrite: () => Promise.resolve(),
      close() {},
    };
    const messageStream = new PgMessageReader(stream);
    const first = messageStream.read();
    await firstReadStarted.promise;
    await expect(messageStream.read()).rejects.toThrow("Previous read not finished");
    continueFirstRead.resolve();
    await expect(first).resolves.toMatchObject({ type: BACKEND_MSG_CODE.readyForQuery });
  });

  it("forwards close operations", async () => {
    const closeWrite = vi.fn();
    const close = vi.fn();
    const stream: ByteStream = {
      ...eofReads,
      write: (buffer) => Promise.resolve(buffer.byteLength),
      closeWrite,
      close,
    };
    const messageStream = new PgMessageReader(stream);
    await messageStream.closeWrite();
    messageStream.close();
    expect(closeWrite).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
});
