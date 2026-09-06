import { describe, expect, it, vi } from "vitest";
import type { ByteStream } from "@/protocol/ByteStream.ts";
import { BACKEND_MSG_CODE } from "@/protocol/pg_message/const.ts";
import { PgMessageReader } from "@/protocol/PgMessageReader.ts";
import { concat, eofReads, frame, int32, readable, readMethods } from "./PgMessageStream.test-helpers.ts";

describe("PgMessageReader", () => {
  it("forwards writes to the byte stream", async () => {
    const writes: Uint8Array[] = [];
    const stream: ByteStream = {
      ...eofReads,
      async write(buffer) {
        writes.push(buffer);
        return buffer.byteLength;
      },
      closeWrite: () => Promise.resolve(),
      close() {},
    };
    const reader = new PgMessageReader(stream);
    const data = Uint8Array.of(1, 2, 3);
    await reader.write(data);
    expect(writes).toEqual([data]);
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
    const reader = new PgMessageReader(stream);
    const first = reader.read();
    await firstReadStarted.promise;
    await expect(reader.read()).rejects.toThrow("Previous read not finished");
    continueFirstRead.resolve();
    await expect(first).resolves.toMatchObject({ type: BACKEND_MSG_CODE.readyForQuery });
  });

  it("keeps the read lock until the body is consumed", async () => {
    const reader = new PgMessageReader(readable(frame(BACKEND_MSG_CODE.readyForQuery, Uint8Array.of(0x49))));
    const message = await reader.read();
    await expect(reader.read()).rejects.toThrow("Previous read not finished");
    await expect(message!.readBody()).resolves.toEqual(Uint8Array.of(0x49));
  });

  it("rejects malformed lengths and propagates EOF", async () => {
    const invalid = new PgMessageReader(readable(concat(Uint8Array.of(0x5a), int32(3))));
    await expect((await invalid.read())!.readBody()).rejects.toThrow("message length");

    const truncatedHeader = new PgMessageReader(readable(Uint8Array.of(0x5a, 0, 0)));
    await expect(truncatedHeader.read()).rejects.toThrow("Unexpected EOF");

    const truncatedBody = new PgMessageReader(readable(frame(0x5a, Uint8Array.of(1, 2)).subarray(0, 6)));
    await expect((await truncatedBody.read())!.readBody()).rejects.toThrow("Unexpected EOF");
  });

  it("enforces maxMessageSize", async () => {
    const reader = new PgMessageReader(readable(frame(BACKEND_MSG_CODE.dataRow, Uint8Array.of(1, 2, 3, 4, 5))), 8);
    await expect((await reader.read())!.readBody()).rejects.toThrow("message length");
  });

  it("unlocks after a body read failure", async () => {
    const header = frame(BACKEND_MSG_CODE.readyForQuery, Uint8Array.of(0x49)).subarray(0, 5);
    let bodyReads = 0;
    const stream: ByteStream = {
      read: async () => {
        if (bodyReads++ === 0) throw new Error("read failed");
        return Uint8Array.of(0x49);
      },
      readInto: (buffer) => {
        buffer.set(header);
        return Promise.resolve();
      },
      write: (buffer) => Promise.resolve(buffer.byteLength),
      closeWrite: () => Promise.resolve(),
      close() {},
    };
    const reader = new PgMessageReader(stream);
    await expect((await reader.read())!.readBody()).rejects.toThrow("read failed");
    const next = await reader.read();
    expect(next?.type).toBe(BACKEND_MSG_CODE.readyForQuery);
    await expect(next!.readBody()).resolves.toEqual(Uint8Array.of(0x49));
  });

  it("closes the write side before the stream", async () => {
    const calls: string[] = [];
    const closeWrite = vi.fn();
    const close = vi.fn();
    const stream: ByteStream = {
      ...eofReads,
      write: (buffer) => Promise.resolve(buffer.byteLength),
      closeWrite: async () => {
        calls.push("closeWrite");
        closeWrite();
      },
      close: () => {
        calls.push("close");
        close();
      },
    };
    const reader = new PgMessageReader(stream);
    await reader.close();
    expect(closeWrite).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(calls).toEqual(["closeWrite", "close"]);
  });
});
