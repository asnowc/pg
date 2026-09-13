import type { PgMessageReader, PgSessionInfo } from "@/protocol.ts";

export class PgRawConnection {
  readonly session: PgSessionInfo;
  readonly reader: PgMessageReader;
}
