import { describe, expect, it } from "vitest";
import { BACKEND_MSG_CODE, PgFormat, PgTransactionStatus } from "@/protocol/pg_message/const.ts";
import { decodeBackendMessage } from "@/protocol/pg_message/decode.ts";
import { PgMessageReader } from "@/protocol/PgMessageReader.ts";
import { concat, cstring, frame, int16, int32, readable, uint32 } from "./PgMessageStream.test-helpers.ts";

async function createPgMessageStream(input: Uint8Array) {
  const reader = new PgMessageReader(readable(input));
  return {
    async read() {
      const message = await reader.read();
      if (!message) return null;
      return decodeBackendMessage(message.type, await message.readBody());
    },
  };
}

describe("PgMessageStream read", () => {
  const backendCases: readonly [string, number, Uint8Array, Readonly<Record<string, unknown>>][] = [
    ["AuthenticationOk", BACKEND_MSG_CODE.authentication, int32(0), { code: 0 }],
    [
      "AuthenticationSASL",
      BACKEND_MSG_CODE.authentication,
      concat(int32(10), cstring("SCRAM-SHA-256"), Uint8Array.of(0)),
      { code: 10, mechanisms: ["SCRAM-SHA-256"] },
    ],
    ["AuthenticationSASLContinue", BACKEND_MSG_CODE.authentication, concat(int32(11), Uint8Array.of(7, 8)), {
      code: 11,
      data: Uint8Array.of(7, 8),
    }],
    ["BackendKeyData", BACKEND_MSG_CODE.backendKeyData, concat(int32(42), uint32(0xf000_0001)), {
      processId: 42,
      secretKey: 0xf000_0001,
    }],
    ["BindComplete", BACKEND_MSG_CODE.bindComplete, new Uint8Array(), {}],
    ["CloseComplete", BACKEND_MSG_CODE.closeComplete, new Uint8Array(), {}],
    ["CommandComplete", BACKEND_MSG_CODE.commandComplete, cstring("SELECT 1"), { tag: "SELECT 1" }],
    ["CopyData", BACKEND_MSG_CODE.copyData, Uint8Array.of(1, 2), { data: Uint8Array.of(1, 2) }],
    ["CopyDone", BACKEND_MSG_CODE.copyDone, new Uint8Array(), {}],
    ["CopyInResponse", BACKEND_MSG_CODE.copyInResponse, concat(Uint8Array.of(1), int16(2), int16(0), int16(1)), {
      overallFormat: PgFormat.binary,
      columnFormats: [PgFormat.text, PgFormat.binary],
    }],
    ["CopyOutResponse", BACKEND_MSG_CODE.copyOutResponse, concat(Uint8Array.of(0), int16(0)), {
      overallFormat: PgFormat.text,
      columnFormats: [],
    }],
    ["CopyBothResponse", BACKEND_MSG_CODE.copyBothResponse, concat(Uint8Array.of(1), int16(1), int16(1)), {
      overallFormat: PgFormat.binary,
      columnFormats: [PgFormat.binary],
    }],
    ["DataRow", BACKEND_MSG_CODE.dataRow, concat(int16(2), int32(1), Uint8Array.of(9), int32(-1)), {
      values: [Uint8Array.of(9), null],
    }],
    ["EmptyQueryResponse", BACKEND_MSG_CODE.emptyQuery, new Uint8Array(), {}],
    [
      "NegotiateProtocolVersion",
      BACKEND_MSG_CODE.negotiateProtocolVersion,
      concat(int32(2), int32(1), cstring("_pq_.x")),
      {
        newestMinorVersion: 2,
        unsupportedOptions: ["_pq_.x"],
      },
    ],
    ["NoData", BACKEND_MSG_CODE.noData, new Uint8Array(), {}],
    ["NotificationResponse", BACKEND_MSG_CODE.notification, concat(int32(7), cstring("channel"), cstring("payload")), {
      processId: 7,
      channel: "channel",
      payload: "payload",
    }],
    ["ParameterDescription", BACKEND_MSG_CODE.parameterDescription, concat(int16(2), uint32(23), uint32(25)), {
      dataTypeOids: [23, 25],
    }],
    ["ParameterStatus", BACKEND_MSG_CODE.parameterStatus, concat(cstring("client_encoding"), cstring("UTF8")), {
      name: "client_encoding",
      value: "UTF8",
    }],
    ["ParseComplete", BACKEND_MSG_CODE.parseComplete, new Uint8Array(), {}],
    ["PortalSuspended", BACKEND_MSG_CODE.portalSuspended, new Uint8Array(), {}],
    ["ReadyForQuery", BACKEND_MSG_CODE.readyForQuery, Uint8Array.of(PgTransactionStatus.Transaction), {
      status: PgTransactionStatus.Transaction,
    }],
    [
      "RowDescription",
      BACKEND_MSG_CODE.rowDescription,
      concat(int16(1), cstring("id"), uint32(10), int16(2), uint32(23), int16(4), int32(-1), int16(1)),
      {
        fields: [{
          name: "id",
          tableOid: 10,
          columnAttribute: 2,
          dataTypeOid: 23,
          dataTypeSize: 4,
          typeModifier: -1,
          format: PgFormat.binary,
        }],
      },
    ],
  ];

  it.each(backendCases)("parses %s", async (_name, code, body, expected) => {
    const messageStream = await createPgMessageStream(frame(code, body));
    await expect(messageStream.read()).resolves.toEqual({ type: code, byteLength: body.byteLength, ...expected });
    await expect(messageStream.read()).rejects.toThrow("Unexpected EOF");
  });

  it("rejects invalid ReadyForQuery status", async () => {
    await expect(
      createPgMessageStream(frame(BACKEND_MSG_CODE.readyForQuery, Uint8Array.of(0x58))).then((stream) => stream.read()),
    ).rejects.toThrow("ReadyForQuery");
  });

  it("propagates EOF errors", async () => {
    await expect(createPgMessageStream(new Uint8Array()).then((stream) => stream.read())).rejects.toThrow(
      "Unexpected EOF",
    );
    await expect(createPgMessageStream(Uint8Array.of(0x5a, 0, 0)).then((stream) => stream.read())).rejects.toThrow(
      "Unexpected EOF",
    );
    await expect(createPgMessageStream(concat(Uint8Array.of(0x5a), int32(5))).then((stream) => stream.read())).rejects
      .toThrow("Unexpected EOF");
  });

  it.each([BACKEND_MSG_CODE.error, BACKEND_MSG_CODE.notice])("parses error fields for message %s", async (code) => {
    const body = concat(
      Uint8Array.of(0x53),
      cstring("ERROR"),
      Uint8Array.of(0x43),
      cstring("22000"),
      Uint8Array.of(0x4d),
      cstring("bad value"),
      Uint8Array.of(0x58),
      cstring("future"),
      Uint8Array.of(0),
    );
    const messageStream = await createPgMessageStream(frame(code, body));
    await expect(messageStream.read()).resolves.toEqual({
      type: code,
      byteLength: body.byteLength,
      fields: { severity: "ERROR", code: "22000", message: "bad value" },
      info: { X: "future" },
    });
  });

  it("preserves unknown backend messages", async () => {
    const body = Uint8Array.of(1, 2, 3);
    const messageStream = await createPgMessageStream(frame(0x79, body));
    await expect(messageStream.read()).resolves.toEqual({
      type: BACKEND_MSG_CODE.unknown,
      byteLength: 3,
      code: 0x79,
      data: body,
    });
  });

  it("rejects malformed known messages", async () => {
    await expect(createPgMessageStream(concat(Uint8Array.of(0x5a), int32(3))).then((stream) => stream.read())).rejects
      .toThrow("message length");
    await expect(
      createPgMessageStream(frame(BACKEND_MSG_CODE.bindComplete, Uint8Array.of(0))).then((stream) => stream.read()),
    ).rejects.toThrow("trailing");
    await expect(
      createPgMessageStream(frame(BACKEND_MSG_CODE.backendKeyData, concat(int32(1), uint32(2), uint32(3)))).then((
        stream,
      ) => stream.read()),
    ).rejects.toThrow("protocol 3.0");
  });
});
