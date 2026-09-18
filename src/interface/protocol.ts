/** @public */
export enum AsyncMessageType {
  Notice = "Notice",
  Notification = "Notification",
}

/** @public */
export type PgAsyncMessage =
  | { type: AsyncMessageType.Notice; fields: PgErrorFields; info: Readonly<Record<string, string>> }
  | { type: AsyncMessageType.Notification; processId: number; channel: string; payload: string };

/** @public */
export interface PgErrorFields {
  severity: string;
  severityNonLocalized?: string;
  code: string;
  message: string;
  detail?: string;
  hint?: string;
  position?: string;
  internalPosition?: string;
  internalQuery?: string;
  where?: string;
  schema?: string;
  table?: string;
  column?: string;
  dataType?: string;
  constraint?: string;
  file?: string;
  line?: string;
  routine?: string;
}
