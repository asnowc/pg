import { BACKEND_MSG_CODE, FRONTEND_MSG_CODE } from "./pg_message.ts";
import type { PgBackendMessage, PgFrontendMessage } from "./pg_message.ts";

export function copyDataMessage(data: Uint8Array): Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.CopyData }> {
  return { type: FRONTEND_MSG_CODE.CopyData, data };
}

export function copyDoneMessage(): Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.CopyDone }> {
  return { type: FRONTEND_MSG_CODE.CopyDone };
}

export function copyFailMessage(reason: string): Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.CopyFail }> {
  return { type: FRONTEND_MSG_CODE.CopyFail, reason };
}

export function isCopyDataMessage(
  message: PgBackendMessage,
): message is Extract<PgBackendMessage, { type: BACKEND_MSG_CODE.CopyData }> {
  return message.type === BACKEND_MSG_CODE.CopyData;
}
