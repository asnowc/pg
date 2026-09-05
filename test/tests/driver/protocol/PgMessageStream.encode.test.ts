import { describe, expect, it } from "vitest";
import { FRONTEND_MSG_CODE, PgFormat } from "@/driver/protocol/pg_message/const.ts";
import { encodeFrontendMessage } from "@/driver/protocol/pg_message/encode.ts";
import type { PgFrontendMessage } from "@/driver/protocol/pg_message/messages.ts";
import { concat, cstring, frame, int16, int32, uint32 } from "./PgMessageStream.test-helpers.ts";

describe("serializeFrontendMessage", () => {
  const frontendCases: readonly [string, PgFrontendMessage, Uint8Array][] = [
    ["password", { type: FRONTEND_MSG_CODE.password, password: "secret" }, cstring("secret")],
    ["raw password response", { type: FRONTEND_MSG_CODE.password, data: Uint8Array.of(1, 2) }, Uint8Array.of(1, 2)],
    [
      "SASL initial response",
      { type: FRONTEND_MSG_CODE.password, mechanism: "SCRAM-SHA-256", data: Uint8Array.of(3, 4) },
      concat(cstring("SCRAM-SHA-256"), int32(2), Uint8Array.of(3, 4)),
    ],
    [
      "SASL initial response without data",
      { type: FRONTEND_MSG_CODE.password, mechanism: "OAUTHBEARER", data: null },
      concat(cstring("OAUTHBEARER"), int32(-1)),
    ],
    ["query", { type: FRONTEND_MSG_CODE.query, sql: "select 1" }, cstring("select 1")],
    ["query with multibyte text", { type: FRONTEND_MSG_CODE.query, sql: "select '中文'" }, cstring("select '中文'")],
    [
      "parse",
      { type: FRONTEND_MSG_CODE.parse, statement: "s", sql: "select $1", parameterTypeOids: [23] },
      concat(cstring("s"), cstring("select $1"), int16(1), uint32(23)),
    ],
    [
      "bind",
      {
        type: FRONTEND_MSG_CODE.bind,
        portal: "p",
        statement: "s",
        parameters: [Uint8Array.of(9), null],
        parameterFormats: [PgFormat.binary],
        resultFormats: [PgFormat.text, PgFormat.binary],
      },
      concat(cstring("p"), cstring("s"), int16(1), int16(1), int16(2), int32(1), Uint8Array.of(9), int32(-1), int16(2), int16(0), int16(1)),
    ],
    ["describe", { type: FRONTEND_MSG_CODE.describe, target: "statement", name: "s" }, concat(Uint8Array.of(0x53), cstring("s"))],
    ["execute", { type: FRONTEND_MSG_CODE.execute, portal: "p", maxRows: 10 }, concat(cstring("p"), int32(10))],
    ["close", { type: FRONTEND_MSG_CODE.close, target: "portal", name: "p" }, concat(Uint8Array.of(0x50), cstring("p"))],
    ["flush", { type: FRONTEND_MSG_CODE.flush }, new Uint8Array()],
    ["sync", { type: FRONTEND_MSG_CODE.sync }, new Uint8Array()],
    ["copy data", { type: FRONTEND_MSG_CODE.copyData, data: Uint8Array.of(5, 6) }, Uint8Array.of(5, 6)],
    ["copy done", { type: FRONTEND_MSG_CODE.copyDone }, new Uint8Array()],
    ["copy fail", { type: FRONTEND_MSG_CODE.copyFail, reason: "failed" }, cstring("failed")],
    ["terminate", { type: FRONTEND_MSG_CODE.terminate }, new Uint8Array()],
  ];

  it.each(frontendCases)("encodes %s", (_name, message, body) => {
    expect(concat(...encodeFrontendMessage(message))).toEqual(frame(message.type, body));
  });

  it("reuses binary message data", () => {
    const data = Uint8Array.of(1, 2, 3);
    expect(encodeFrontendMessage({ type: FRONTEND_MSG_CODE.copyData, data })[1]).toBe(data);
  });

  it("rejects invalid values", () => {
    expect(() => encodeFrontendMessage({ type: FRONTEND_MSG_CODE.query, sql: "a\0b" })).toThrow("NUL");
    expect(() => encodeFrontendMessage({ type: FRONTEND_MSG_CODE.execute, portal: "", maxRows: 0x8000_0000 })).toThrow("maxRows");
    expect(() => encodeFrontendMessage({ type: FRONTEND_MSG_CODE.parse, statement: "", sql: "select $1", parameterTypeOids: [-1] })).toThrow("Parameter type OID");
    expect(() => encodeFrontendMessage({ type: FRONTEND_MSG_CODE.parse, statement: "", sql: "select 1", parameterTypeOids: Array(0x1_0000).fill(23) })).toThrow("Parameter type count");
  });
});
