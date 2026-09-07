import { BACKEND_MSG_CODE, FRONTEND_MSG_CODE } from "./pg_message.ts";
import type { PgBackendMessage, PgFrontendMessage } from "./pg_message.ts";

/** @public */
export function copyDataMessage(data: Uint8Array): Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.copyData }> {
  return { type: FRONTEND_MSG_CODE.copyData, data };
}

/** @public */
export function copyDoneMessage(): Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.copyDone }> {
  return { type: FRONTEND_MSG_CODE.copyDone };
}

/** @public */
export function copyFailMessage(reason: string): Extract<PgFrontendMessage, { type: FRONTEND_MSG_CODE.copyFail }> {
  return { type: FRONTEND_MSG_CODE.copyFail, reason };
}

/** @public */
export function isCopyDataMessage(
  message: PgBackendMessage,
): message is Extract<PgBackendMessage, { type: BACKEND_MSG_CODE.copyData }> {
  return message.type === BACKEND_MSG_CODE.copyData;
}
